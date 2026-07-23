// Provider-agnostic contract. The UI and the persistence layer talk ONLY to this
// interface, so HeyGen and Tavus are interchangeable behind it.

// Every utterance (mine + the avatar's) is normalized to this shape before it is
// emitted on 'transcript' and persisted.
export interface TranscriptEntry {
  role: 'user' | 'avatar';
  text: string;
  ts: number;
  seq?: number;
}

export type ProviderName = 'heygen' | 'tavus';

// UI-facing connection state. Providers map their own lifecycle onto these.
export type ProviderState =
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'speaking'
  | 'stopped'
  // The avatar signalled it is done with the current question (Tavus: via the
  // end_interview tool call). Drives the client's soft auto-advance.
  | 'complete';

export type ProviderEvent = 'transcript' | 'state' | 'error';

// Both providers signal "interview done" by SPEAKING a fixed closing phrase once: the
// server appends an instruction to say it verbatim, and each provider client detects it in
// the avatar transcript to emit 'complete'. (HeyGen FULL mode has no tool-calling, and the
// Tavus end_interview tool was never actually registered — so a spoken sentinel is the one
// mechanism that works on both.) Shared here so every side stays in sync.
export const HEYGEN_END_PHRASE = 'L’intervista è conclusa, grazie.';

// Accent/case/punctuation-insensitive check that the utterance ENDS with the closing
// sentinel. endsWith (not includes) tolerates a spoken prefix ("Bene, l'intervista è
// conclusa, grazie") and TTS/transcription variance, while refusing to fire when the phrase
// merely appears mid-sentence — which would wrongly end the interview early.
export function matchesEndPhrase(text: string): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      // NFD splits accents into combining marks; [^a-z0-9 ] then drops them and punctuation.
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return norm(text).endsWith(norm(HEYGEN_END_PHRASE));
}

// Whatever the /api/interview/start endpoint returned for this provider, plus the DB
// session id. Kept loose because each provider needs different connection fields
// (HeyGen: sessionToken; Tavus: conversationUrl).
export interface StartConfig {
  dbSessionId: number;
  providerSessionId?: string;
  sessionToken?: string; // heygen
  conversationUrl?: string; // tavus
  [k: string]: unknown;
}

export interface StartResult {
  providerSessionId?: string;
}

export interface InterviewProvider {
  start(mountEl: HTMLElement, cfg: StartConfig): Promise<StartResult>;
  toggleMic(): Promise<void>; // start/stop (mute/unmute) voice chat
  stop(): Promise<void>;
  on(evt: ProviderEvent, cb: (payload: unknown) => void): void;
  // Optional: ~20s before the timer expires, nudge the avatar to wrap the question up
  // (HeyGen only — via session.message()). Tavus relies on its server-side hard cap.
  nudgeWrapUp?(): void;
}
