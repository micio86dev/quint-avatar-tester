import type { APIRoute } from 'astro';
// Secrets are read ONLY here (server-side). API keys never reach the browser.
import {
  LIVEAVATAR_API_KEY,
  LIVEAVATAR_AVATAR_ID,
  LIVEAVATAR_VOICE_ID,
  LIVEAVATAR_LANGUAGE,
  TAVUS_API_KEY,
  TAVUS_REPLICA_ID,
  TAVUS_PERSONA_ID,
} from 'astro:env/server';
import { composeInterviewPrompt, timezoneContext } from '../../../lib/prompt';
import { rates } from '../../../lib/pricing';
import { timing, resolveSessionCap } from '../../../lib/timing';
import { parseStoredConfig } from '../admin/_helpers';
import {
  createSession,
  getPrompt,
  getTemplate,
  getTemplateQuestions,
} from '../../../lib/db';

export const prerender = false;

const LA_CONTEXTS_URL = 'https://api.liveavatar.com/v1/contexts';
const LA_TOKEN_URL = 'https://api.liveavatar.com/v1/sessions/token';
const TAVUS_CONVERSATIONS_URL = 'https://tavusapi.com/v2/conversations';

// Start LOW so latency feels instant while testing. Bump to 'high'/'very_high' later
// for fidelity. Allowed: 'very_high' | 'high' | 'medium' | 'low'.
const HEYGEN_VIDEO_QUALITY = 'low';

// If a participant leaves the Tavus room, end shortly after (frees the slot promptly).
const TAVUS_PARTICIPANT_LEFT_TIMEOUT = 5;

// Free-tier concurrency-slot release lags the 'ended' status by a few seconds. When a
// start races that window, wait and retry the create instead of failing. Up to
// RETRIES * BACKOFF_MS (~6s) of added latency, and ONLY on the concurrency error.
const TAVUS_CONCURRENCY_RETRIES = 3;
const TAVUS_CONCURRENCY_BACKOFF_MS = 2000;

// A parsed provider-config blob (camelCase keys, matching the admin UI) or null when the
// template has no config for the selected provider — fields then fall back to .env.
type ProviderConfig = Record<string, unknown> | null;

// Everything a start needs after validation + composition: the resolved session cap, the
// composed context + greeting, the parsed provider config, and the session identifiers.
interface StartRequest {
  promptId: number;
  templateId: number;
  systemPrompt: string;
  greeting: string;
  config: ProviderConfig;
  cap: number;
  timezone: string | null;
}

// Narrow a parsed config to a plain object (or null). Arrays and primitives are rejected.
function asConfig(value: unknown): ProviderConfig {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Read a string config field, returning undefined when absent or empty so the caller
// falls back to its .env default.
function str(cfg: ProviderConfig, key: string): string | undefined {
  const v = cfg?.[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

// Read a number config field, returning undefined when absent or not finite.
function num(cfg: ProviderConfig, key: string): number | undefined {
  const v = cfg?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Read a boolean config field, returning undefined when absent so the caller can default.
function bool(cfg: ProviderConfig, key: string): boolean | undefined {
  const v = cfg?.[key];
  return typeof v === 'boolean' ? v : undefined;
}

// Read a string config field but ONLY accept a value from the documented allowlist.
// Anything else (unknown/absent/wrong type) returns undefined so the caller falls back
// to its default — an arbitrary string never reaches the provider.
function oneOf<T extends string>(
  cfg: ProviderConfig,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = str(cfg, key);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

// Documented HeyGen enum values. Config values outside these sets are ignored.
const HEYGEN_INTERACTIVITY_TYPES = ['CONVERSATIONAL', 'PUSH_TO_TALK'] as const;
const HEYGEN_VIDEO_QUALITIES = ['very_high', 'high', 'medium', 'low'] as const;
const HEYGEN_VIDEO_ENCODINGS = ['H264', 'VP8'] as const;

// Parse + validate the request, then compose the continuous Italian interview context.
// Returns either a ready-to-use StartRequest or an error Response.
function prepare(
  provider: 'heygen' | 'tavus',
  body: { promptId?: unknown; templateId?: unknown; timezone?: unknown } | null,
): StartRequest | Response {
  const promptId = Number(body?.promptId);
  const templateId = Number(body?.templateId);
  const timezone = typeof body?.timezone === 'string' && body.timezone ? body.timezone : null;

  if (!Number.isInteger(promptId) || promptId <= 0) return json(400, { error: 'Invalid promptId.' });
  if (!Number.isInteger(templateId) || templateId <= 0) return json(400, { error: 'Invalid templateId.' });

  const prompt = getPrompt(promptId);
  if (!prompt) return json(404, { error: 'Unknown prompt.' });
  const template = getTemplate(templateId);
  if (!template) return json(404, { error: 'Unknown template.' });

  const templateQuestions = getTemplateQuestions(templateId);
  if (templateQuestions.length === 0) {
    return json(400, { error: 'Template has no questions.' });
  }

  // Provider config is stored per-template as a JSON string (camelCase keys). Absent or
  // unparseable → null, and every field falls back to its .env default.
  const config = asConfig(
    parseStoredConfig(provider === 'heygen' ? template.heygen_config : template.tavus_config),
  );

  const maxFromConfig =
    provider === 'heygen'
      ? num(config, 'maxSessionDurationSec')
      : num(config, 'maxCallDurationSec');
  const cap = resolveSessionCap(provider, maxFromConfig);

  // Non-empty fallback so the provider never receives an empty opening_text/custom_greeting.
  // The Italian default is spoken content, so keep it in Italian.
  const greeting = (prompt.greeting && prompt.greeting.trim()) || 'Ciao!';

  const { systemPrompt, greeting: composedGreeting } = composeInterviewPrompt({
    promptBody: prompt.body,
    greeting,
    questions: templateQuestions.map((q) => ({
      name: q.name,
      text: q.text,
      objective: q.objective,
    })),
    provider,
    maxSeconds: cap,
  });

  return {
    promptId,
    templateId,
    systemPrompt,
    greeting: composedGreeting,
    config,
    cap,
    timezone,
  };
}

export const POST: APIRoute = async ({ request, url }) => {
  const body = (await request.json().catch(() => null)) as
    | { promptId?: unknown; templateId?: unknown; provider?: unknown; timezone?: unknown }
    | null;

  const provider = (body?.provider as string) ?? url.searchParams.get('provider');
  if (provider !== 'heygen' && provider !== 'tavus') {
    return json(400, { error: "'provider' must be 'heygen' or 'tavus'." });
  }

  const prepared = prepare(provider, body);
  if (prepared instanceof Response) return prepared;

  try {
    const res =
      provider === 'heygen' ? await startHeygen(prepared) : await startTavus(prepared);
    return res;
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : String(err) });
  }
};

// Extra fields every successful start returns, so the client can drive the timer without
// reading server secrets.
function meta(req: StartRequest) {
  return {
    pricing: rates,
    sessionMaxSeconds: req.cap,
    warnSeconds: timing.warnSeconds,
  };
}

async function startHeygen(req: StartRequest): Promise<Response> {
  if (!LIVEAVATAR_API_KEY) return json(500, { error: 'Missing LIVEAVATAR_API_KEY in .env.' });
  const avatarId = str(req.config, 'avatarId') ?? LIVEAVATAR_AVATAR_ID;
  const voiceId = str(req.config, 'voiceId') ?? LIVEAVATAR_VOICE_ID;
  if (!avatarId || !voiceId) {
    return json(500, { error: 'Missing HeyGen avatar_id or voice_id (config + .env).' });
  }

  // A fresh Context per start: the prompt is template-specific and the completion
  // instruction is baked in by composeInterviewPrompt, so there is nothing stable to cache.
  const contextId = await createHeygenContext(
    timezoneContext(req.timezone) + req.systemPrompt,
    req.greeting,
    req.promptId,
    req.templateId,
  );

  // Build voice_settings only from the voice knobs present in the config; omit the whole
  // object when none are set so HeyGen keeps its voice defaults.
  const voiceSettings: Record<string, unknown> = {};
  const speed = num(req.config, 'voiceSpeed');
  if (speed !== undefined) voiceSettings.speed = speed;
  const stability = num(req.config, 'voiceStability');
  if (stability !== undefined) voiceSettings.stability = stability;
  const similarityBoost = num(req.config, 'voiceSimilarityBoost');
  if (similarityBoost !== undefined) voiceSettings.similarity_boost = similarityBoost;
  const style = num(req.config, 'voiceStyle');
  if (style !== undefined) voiceSettings.style = style;
  const useSpeakerBoost = bool(req.config, 'voiceUseSpeakerBoost');
  if (useSpeakerBoost !== undefined) voiceSettings.use_speaker_boost = useSpeakerBoost;

  const avatarPersona: Record<string, unknown> = {
    voice_id: voiceId,
    context_id: contextId,
    language: str(req.config, 'language') ?? LIVEAVATAR_LANGUAGE,
  };
  if (Object.keys(voiceSettings).length > 0) avatarPersona.voice_settings = voiceSettings;

  // Only include a recognized encoding; an unknown value is omitted so HeyGen keeps its default.
  const videoEncoding = oneOf(req.config, 'videoEncoding', HEYGEN_VIDEO_ENCODINGS);

  // FULL mode: HeyGen provides ASR + LLM + TTS. All avatar/voice/quality/language config
  // lives in the token request.
  const tokenRes = await fetch(LA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': LIVEAVATAR_API_KEY },
    body: JSON.stringify({
      mode: 'FULL',
      avatar_id: avatarId,
      is_sandbox: false,
      interactivity_type:
        oneOf(req.config, 'interactivityType', HEYGEN_INTERACTIVITY_TYPES) ?? 'CONVERSATIONAL',
      video_settings: {
        quality: oneOf(req.config, 'videoQuality', HEYGEN_VIDEO_QUALITIES) ?? HEYGEN_VIDEO_QUALITY,
        ...(videoEncoding ? { encoding: videoEncoding } : {}),
      },
      max_session_duration: req.cap,
      avatar_persona: avatarPersona,
    }),
  });
  const payload = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok) throw new Error(`LiveAvatar rejected the token request (HTTP ${tokenRes.status}).`);
  const data = payload?.data ?? {};
  if (!data.session_token) throw new Error('LiveAvatar returned no session_token.');

  const providerSessionId: string | null = data.session_id ?? null;
  const dbSessionId = createSession('heygen', providerSessionId, {
    promptId: req.promptId,
    templateId: req.templateId,
    timezone: req.timezone ?? undefined,
  });

  return json(200, {
    dbSessionId,
    provider: 'heygen',
    sessionToken: data.session_token,
    providerSessionId,
    ...meta(req),
  });
}

async function createHeygenContext(
  prompt: string,
  openingText: string,
  promptId: number,
  templateId: number,
): Promise<string> {
  const res = await fetch(LA_CONTEXTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': LIVEAVATAR_API_KEY },
    body: JSON.stringify({
      // Context names must be UNIQUE per LiveAvatar account. A stable name collided on
      // every interview after the first ("Context with this name already exists"). We
      // create a fresh context each start, so the name carries prompt/template + timestamp.
      name: `Colloquio — p${promptId} — t${templateId}-${Date.now()}`,
      prompt,
      opening_text: openingText,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    // Surface LiveAvatar's actual complaint instead of a blind status code — a 400
    // here is almost always a rejected field (prompt/opening_text), and the body says which.
    const detail = payload?.message ?? payload?.error ?? payload?.data?.message ?? `HTTP ${res.status}`;
    throw new Error(`LiveAvatar context creation failed: ${detail}`);
  }
  const id: string | undefined = payload?.data?.id;
  if (!id) throw new Error('LiveAvatar context response had no id.');
  return id;
}

// Detects Tavus' concurrency-limit rejection (free tier allows only 1 concurrent
// conversation). A prior /end can lag behind on Tavus' side, so a fresh start briefly
// races an already-teardown conversation that still counts as active.
function isConcurrencyLimit(detail: string): boolean {
  return /maximum concurrent conversations/i.test(detail);
}

// Reap leftover active conversations so the single free-tier slot is freed. Called only
// when a create is rejected for concurrency — self-heals a lagging or failed prior /end
// without slowing the happy path.
async function endActiveTavusConversations(): Promise<number> {
  const list = await fetch(`${TAVUS_CONVERSATIONS_URL}?status=active`, {
    headers: { 'x-api-key': TAVUS_API_KEY as string },
  });
  const payload = await list.json().catch(() => null);
  const rows: Array<{ conversation_id?: string; status?: string }> = Array.isArray(payload?.data)
    ? payload.data
    : [];
  const active = rows.filter((c) => c.conversation_id && c.status === 'active');
  await Promise.all(
    active.map((c) =>
      fetch(`${TAVUS_CONVERSATIONS_URL}/${c.conversation_id}/end`, {
        method: 'POST',
        headers: { 'x-api-key': TAVUS_API_KEY as string },
      }).catch(() => {}),
    ),
  );
  return active.length;
}

async function createTavusConversation(req: StartRequest): Promise<Response> {
  // NOTE: Tavus persona-level knobs (llmModel / llmTemperature / tts* / turnTakingPatience /
  // flow / idleEngagement, etc.) are properties of the PAL/persona, NOT of conversation
  // create — they are selected today via the config's palId (persona_id below). Overriding
  // them per-template would require PAL management (create/patch a persona), which is out of
  // scope here, so we intentionally do NOT send them in the conversation body. Only
  // conversation-level fields are applied.
  const cfg = req.config;
  return fetch(TAVUS_CONVERSATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': TAVUS_API_KEY as string },
    body: JSON.stringify({
      replica_id: str(cfg, 'faceId') ?? TAVUS_REPLICA_ID,
      persona_id: str(cfg, 'palId') ?? TAVUS_PERSONA_ID,
      // Tavus uses the persona's OWN LLM ("its brain"); the script (with the baked-in
      // end_interview tool instruction from composeInterviewPrompt) is injected as context.
      conversational_context: timezoneContext(req.timezone) + req.systemPrompt,
      custom_greeting: req.greeting,
      audio_only: bool(cfg, 'audioOnly') ?? false,
      properties: {
        language: str(cfg, 'language') ?? 'italian',
        enable_recording: bool(cfg, 'enableRecording') ?? false,
        enable_closed_captions: bool(cfg, 'enableClosedCaptions') ?? false,
        // Server-side hard cap so a session can't overrun the resolved budget
        // (fields confirmed in seconds against the Tavus OpenAPI spec).
        max_call_duration: req.cap,
        participant_absent_timeout: Math.min(
          num(cfg, 'participantAbsentTimeoutSec') ?? req.cap,
          req.cap,
        ),
        participant_left_timeout: TAVUS_PARTICIPANT_LEFT_TIMEOUT,
      },
    }),
  });
}

async function startTavus(req: StartRequest): Promise<Response> {
  if (!TAVUS_API_KEY) return json(500, { error: 'Missing TAVUS_API_KEY in .env.' });
  const replicaId = str(req.config, 'faceId') ?? TAVUS_REPLICA_ID;
  const personaId = str(req.config, 'palId') ?? TAVUS_PERSONA_ID;
  if (!replicaId || !personaId) {
    return json(500, { error: 'Missing Tavus replica_id or persona_id (config + .env).' });
  }

  let res = await createTavusConversation(req);
  let payload = await res.json().catch(() => null);

  // Concurrency rejection handling. On the free tier Tavus allows 1 concurrent
  // conversation and releases that slot a few seconds AFTER the prior conversation reports
  // 'ended' — so a fresh start briefly races a slot that is gone by status but not yet by
  // accounting. The account often shows ZERO active conversations at this point, so there
  // is nothing to reap: the only thing that works (confirmed by manual re-click
  // succeeding) is to wait and retry.
  for (let attempt = 0; attempt < TAVUS_CONCURRENCY_RETRIES && !res.ok; attempt++) {
    const detail = String(payload?.message ?? payload?.error ?? `HTTP ${res.status}`);
    if (!isConcurrencyLimit(detail)) break;
    // Best-effort reap in case a genuinely stuck 'active' conversation exists, then wait
    // for Tavus to free the slot before retrying. The wait — not the reap — is the fix.
    await endActiveTavusConversations().catch(() => 0);
    await new Promise((r) => setTimeout(r, TAVUS_CONCURRENCY_BACKOFF_MS));
    res = await createTavusConversation(req);
    payload = await res.json().catch(() => null);
  }
  if (!res.ok) {
    const detail = String(payload?.message ?? payload?.error ?? `HTTP ${res.status}`);
    // Slot still not freed after the retries: surface a friendly, retryable signal instead
    // of a raw 502 so the client can invite the candidate to wait a moment and try again.
    if (isConcurrencyLimit(detail)) {
      return json(429, {
        code: 'provider_busy',
        error:
          'The avatar is still closing the previous session. Try again in a few seconds.',
      });
    }
    throw new Error(`Tavus rejected the conversation request: ${detail}`);
  }
  const conversationUrl: string | undefined = payload?.conversation_url;
  const conversationId: string | null = payload?.conversation_id ?? null;
  if (!conversationUrl) throw new Error('Tavus returned no conversation_url.');

  const dbSessionId = createSession('tavus', conversationId, {
    promptId: req.promptId,
    templateId: req.templateId,
    timezone: req.timezone ?? undefined,
  });

  return json(200, {
    dbSessionId,
    provider: 'tavus',
    conversationUrl,
    providerSessionId: conversationId,
    ...meta(req),
  });
}

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
