// tavus-pal.ts — server-side manager for the Tavus PAL (persona) tied to a template.
//
// The persona-level knobs (LLM model/temperature, TTS engine, turn-taking, interruptibility,
// voice isolation, idle engagement) are NOT conversation-create fields — they live on a Tavus
// PAL. So we manage a PAL per template ON SAVE: create it the first time (storing its id as the
// config's palId), and PATCH it on later saves. The interview start route keeps using palId
// unchanged, so the knobs now take real effect.
//
// Server-only (reads secrets from astro:env/server). Never import from client code.
import { TAVUS_API_KEY, TAVUS_REPLICA_ID } from 'astro:env/server';
import { buildPalLayers, buildPalPatchOps, hasPersonaKnobs } from './provider-config';

const PALS_URL = 'https://tavusapi.com/v2/pals';

// The real interview script is injected as conversational_context at conversation start, so
// the PAL only carries the layer knobs; its system_prompt is a harmless placeholder.
const PLACEHOLDER_PROMPT =
  'Interview avatar for quint-avatar-tester. The interview script is provided at runtime.';

export type PalSync =
  | { status: 'skipped' } //     no persona knobs set — nothing to manage
  | { status: 'unchanged'; palId: string } // existing PAL patched (or nothing to patch)
  | { status: 'created'; palId: string } //   new PAL created — caller must persist palId
  | { status: 'warning'; message: string }; //  could not sync — save the template anyway

function str(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

async function palError(res: Response): Promise<string> {
  const payload = await res.json().catch(() => null);
  return String(payload?.message ?? payload?.error ?? `HTTP ${res.status}`);
}

// A hung Tavus request must not hang the whole template-save HTTP request (Railway then 502s
// with "Application failed to respond"). Bound every PAL call so a slow/unreachable Tavus
// degrades to a warning — the template still saves.
const PAL_TIMEOUT_MS = 10_000;
async function palFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Create or update the Tavus PAL for a template's Tavus config. Returns a discriminated
// result; on 'created' the caller writes result.palId back into the config before persisting.
// Never throws for provider/network failures — returns a 'warning' so the save still succeeds.
export async function syncTavusPal(
  config: Record<string, unknown> | null | undefined,
): Promise<PalSync> {
  if (!config || !hasPersonaKnobs(config)) return { status: 'skipped' };
  if (!TAVUS_API_KEY) {
    return { status: 'warning', message: 'TAVUS_API_KEY is not set — Tavus PAL not synced.' };
  }

  const palId = str(config, 'palId');

  try {
    // Existing PAL → patch the changed layer knobs (JSON Patch, RFC 6902).
    if (palId) {
      const ops = buildPalPatchOps(config);
      if (ops.length === 0) return { status: 'unchanged', palId };
      const res = await palFetch(`${PALS_URL}/${palId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TAVUS_API_KEY },
        body: JSON.stringify(ops),
      });
      // 304 Not Modified: the PAL already holds these exact layer values, so Tavus made no
      // change. That's a successful no-op, not a failure — treat it like a clean patch.
      if (!res.ok && res.status !== 304) {
        return { status: 'warning', message: `Tavus PAL update failed: ${await palError(res)}` };
      }
      return { status: 'unchanged', palId };
    }

    // No PAL yet → create one. Needs a face/replica id (config or .env fallback).
    const faceId = str(config, 'faceId') || TAVUS_REPLICA_ID;
    if (!faceId) {
      return {
        status: 'warning',
        message: 'Cannot create a Tavus PAL without a Face ID (replica).',
      };
    }
    const res = await palFetch(PALS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': TAVUS_API_KEY },
      body: JSON.stringify({
        pal_name: 'quint-avatar-tester',
        system_prompt: PLACEHOLDER_PROMPT,
        pipeline_mode: 'full',
        default_face_id: faceId,
        layers: buildPalLayers(config),
      }),
    });
    if (!res.ok) {
      return { status: 'warning', message: `Tavus PAL creation failed: ${await palError(res)}` };
    }
    const payload = await res.json().catch(() => null);
    const newId: string | undefined = payload?.pal_id ?? payload?.persona_id;
    if (!newId) {
      return { status: 'warning', message: 'Tavus PAL creation returned no id.' };
    }
    return { status: 'created', palId: newId };
  } catch (err) {
    // AbortError = our own timeout fired; report it as a timeout, not a raw abort message.
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'warning', message: `Tavus PAL sync timed out after ${PAL_TIMEOUT_MS / 1000}s.` };
    }
    return {
      status: 'warning',
      message: `Tavus PAL sync error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
