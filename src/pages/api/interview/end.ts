import type { APIRoute } from 'astro';
import { LIVEAVATAR_API_KEY, TAVUS_API_KEY } from 'astro:env/server';
import {
  endSession,
  replaceUtterances,
  setProviderMeta,
  type UtteranceInput,
  type EndedReason,
} from '../../../lib/db';

export const prerender = false;

const VALID_REASONS: EndedReason[] = ['completed', 'timeout', 'user_stop', 'error'];

// Finalize a session: mark it ended (with reason), reconcile HeyGen's authoritative
// transcript, and free the Tavus slot. Provider metadata is fetched in the background.
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { sessionId?: unknown; provider?: unknown; providerSessionId?: unknown; endedReason?: unknown }
    | null;

  const sessionId = Number(body?.sessionId);
  const provider = body?.provider;
  const providerSessionId =
    typeof body?.providerSessionId === 'string' ? body.providerSessionId : null;
  const reason: EndedReason = VALID_REASONS.includes(body?.endedReason as EndedReason)
    ? (body?.endedReason as EndedReason)
    : 'user_stop';

  if (!Number.isInteger(sessionId)) return json(400, { error: 'Invalid sessionId.' });

  endSession(sessionId, providerSessionId, reason);

  // Free the Tavus concurrency slot immediately (the free tier allows only 1 concurrent
  // conversation; relying on the idle-timeout would leave it stuck for minutes).
  if (provider === 'tavus' && providerSessionId && TAVUS_API_KEY) {
    try {
      await fetch(`https://tavusapi.com/v2/conversations/${providerSessionId}/end`, {
        method: 'POST',
        headers: { 'x-api-key': TAVUS_API_KEY },
      });
    } catch {
      /* best-effort; Tavus also ends the room on participant timeout */
    }
  }

  let reconciled = false;
  if (provider === 'heygen' && providerSessionId && LIVEAVATAR_API_KEY) {
    try {
      const res = await fetch(
        `https://api.liveavatar.com/v1/sessions/${providerSessionId}/transcript`,
        { headers: { 'X-API-KEY': LIVEAVATAR_API_KEY } },
      );
      const payload = await res.json().catch(() => null);
      const arr = payload?.data?.transcript_data;
      if (res.ok && Array.isArray(arr) && arr.length) {
        const rows: UtteranceInput[] = arr
          .map((t: { role?: string; transcript?: string }, i: number) => ({
            role: (t.role === 'avatar' ? 'avatar' : 'user') as UtteranceInput['role'],
            text: String(t.transcript ?? '').trim(),
            seq: i,
          }))
          .filter((r: UtteranceInput) => r.text.length > 0);
        if (rows.length) {
          replaceUtterances(sessionId, rows);
          reconciled = true;
        }
      }
    } catch {
      /* network/transcript hiccup → keep the live-captured rows */
    }
  }

  // Fire background provider-data fetches — non-blocking, response already prepared.
  if (provider === 'tavus' && providerSessionId && TAVUS_API_KEY) {
    void fetchTavusMeta(sessionId, providerSessionId, TAVUS_API_KEY);
  }
  if (provider === 'heygen' && providerSessionId && LIVEAVATAR_API_KEY) {
    void fetchHeyGenMeta(sessionId, providerSessionId, LIVEAVATAR_API_KEY);
  }

  return json(200, { ok: true, reconciled });
};

function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Background provider-data fetchers (fire-and-forget, non-blocking) ──────────

type PlainObj = Record<string, unknown>;

export async function fetchTavusMeta(
  dbSessionId: number,
  conversationId: string,
  apiKey: string,
): Promise<void> {
  // Small delay: Tavus processes perception analysis asynchronously after call ends.
  await new Promise<void>((r) => setTimeout(r, 3_000));
  try {
    const res = await fetch(
      `https://tavusapi.com/v2/conversations/${conversationId}?verbose=true`,
      { headers: { 'x-api-key': apiKey } },
    );
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as PlainObj | null;
    if (!data) return;

    const events = Array.isArray(data.events) ? (data.events as PlainObj[]) : [];
    const findEvent = (type: string) => events.find((e) => e.event_type === type);
    const prop = (e: PlainObj | undefined, key: string) =>
      e ? ((e.properties as PlainObj)?.[key] ?? null) : null;

    const perceptionEvent = findEvent('application.perception_analysis');
    const transcriptEvent = findEvent('application.transcription_ready');
    const recordingEvent = findEvent('application.recording_ready');
    const shutdownEvent = findEvent('system.shutdown');

    setProviderMeta(dbSessionId, {
      provider: 'tavus',
      fetched_at: new Date().toISOString(),
      conversation_id: conversationId,
      status: data.status ?? null,
      shutdown_reason:
        data.shutdown_reason ?? prop(shutdownEvent, 'shutdown_reason') ?? null,
      perception_analysis: prop(perceptionEvent, 'analysis'),
      tavus_transcript: prop(transcriptEvent, 'transcript'),
      recording: recordingEvent?.properties ?? null,
    });
  } catch {
    /* best-effort */
  }
}

export async function fetchHeyGenMeta(
  dbSessionId: number,
  sessionId: string,
  apiKey: string,
): Promise<void> {
  try {
    const res = await fetch(`https://api.liveavatar.com/v1/sessions/${sessionId}`, {
      headers: { 'X-API-KEY': apiKey },
    });
    if (!res.ok) return;
    const payload = (await res.json().catch(() => null)) as PlainObj | null;
    const data = (payload?.data as PlainObj) ?? null;
    if (!data) return;

    setProviderMeta(dbSessionId, {
      provider: 'heygen',
      fetched_at: new Date().toISOString(),
      session_id: sessionId,
      duration_sec: data.duration ?? null,
      credits_consumed: data.credits_consumed ?? null,
      end_reason: data.end_reason ?? null,
      mode: data.mode ?? null,
      source: data.source ?? null,
    });
  } catch {
    /* best-effort */
  }
}
