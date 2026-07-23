// Tavus CVI provider. Joins the returned conversation_url (a Daily room) with
// @daily-co/daily-js, audio-only from our side (camera OFF), and normalizes the
// Interactions-Protocol events delivered as Daily `app-message`s:
//  - conversation.utterance -> { properties.role: 'replica'|'user', properties.speech }
//  - conversation.{replica,user}.started/stopped_speaking -> status line
import Daily, {
  type DailyCall,
  type DailyEventObjectAppMessage,
  type DailyEventObjectTrack,
} from '@daily-co/daily-js';
import {
  matchesEndPhrase,
  type InterviewProvider,
  type ProviderEvent,
  type StartConfig,
  type StartResult,
  type TranscriptEntry,
} from './types';

type Handler = (payload: unknown) => void;

interface TavusMessage {
  event_type?: string;
  seq?: number;
  properties?: { role?: string; speech?: string; name?: string };
}

export class TavusProvider implements InterviewProvider {
  private call: DailyCall | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private handlers: Record<ProviderEvent, Handler[]> = { transcript: [], state: [], error: [] };
  // Completion is detected from the avatar's spoken closing sentinel (same as HeyGen). If it
  // lands mid-utterance we defer 'complete' until the replica stops speaking.
  private replicaSpeaking = false;
  private pendingComplete = false;

  on(evt: ProviderEvent, cb: Handler): void {
    this.handlers[evt].push(cb);
  }

  private emit(evt: ProviderEvent, payload: unknown): void {
    for (const cb of this.handlers[evt]) cb(payload);
  }

  async start(mountEl: HTMLElement, cfg: StartConfig): Promise<StartResult> {
    const url = cfg.conversationUrl;
    if (!url) throw new Error('Tavus: missing conversationUrl');
    this.videoEl = mountEl as HTMLVideoElement;

    // videoSource:false = our camera stays OFF; audioSource:true = mic controllable.
    const call = Daily.createCallObject({ audioSource: true, videoSource: false });
    this.call = call;

    call.on('track-started', (ev) => this.attachRemoteTrack(ev));
    call.on('app-message', (ev) => this.onMessage(ev));
    call.on('joined-meeting', () => this.emit('state', 'ready'));
    call.on('left-meeting', () => this.emit('state', 'stopped'));
    call.on('error', (ev) => this.emit('error', ev?.errorMsg ?? 'daily error'));

    this.emit('state', 'connecting');
    await call.join({ url, startVideoOff: true });
    return { providerSessionId: cfg.providerSessionId };
  }

  // The Tavus replica is the only remote participant; pipe its video + audio into
  // our single <video> element via a shared MediaStream.
  private attachRemoteTrack(ev: DailyEventObjectTrack): void {
    if (!ev.participant || ev.participant.local) return;
    if (ev.type !== 'video' && ev.type !== 'audio') return;
    const track = ev.track;
    if (!track || !this.videoEl) return;
    if (!this.stream) this.stream = new MediaStream();
    this.stream
      .getTracks()
      .filter((t) => t.kind === track.kind)
      .forEach((t) => this.stream!.removeTrack(t));
    this.stream.addTrack(track);
    this.videoEl.srcObject = this.stream;
    void this.videoEl.play?.().catch(() => {});
  }

  private onMessage(ev: DailyEventObjectAppMessage): void {
    const msg = ev.data as TavusMessage;
    if (!msg?.event_type) return;
    switch (msg.event_type) {
      case 'conversation.utterance': {
        const role: TranscriptEntry['role'] =
          msg.properties?.role === 'replica' ? 'avatar' : 'user';
        const text = msg.properties?.speech?.trim();
        if (text) {
          this.emit('transcript', { role, text, ts: Date.now(), seq: msg.seq } satisfies TranscriptEntry);
          // Avatar spoke the closing sentinel → interview is over. Defer until it finishes
          // speaking so the final line isn't cut off; fire now if it's already idle.
          if (role === 'avatar' && matchesEndPhrase(text)) {
            if (this.replicaSpeaking) this.pendingComplete = true;
            else this.emit('state', 'complete');
          }
        }
        break;
      }
      case 'conversation.replica.started_speaking':
        this.replicaSpeaking = true;
        this.emit('state', 'speaking');
        break;
      case 'conversation.replica.stopped_speaking':
        this.replicaSpeaking = false;
        this.emit('state', 'ready');
        if (this.pendingComplete) {
          this.pendingComplete = false;
          this.emit('state', 'complete');
        }
        break;
      case 'conversation.user.started_speaking':
        this.emit('state', 'listening');
        break;
      case 'conversation.user.stopped_speaking':
        this.emit('state', 'ready');
        break;
      case 'conversation.tool_call':
        // Fallback path: if an end_interview tool ever gets registered on the persona, honor
        // it too. Primary completion now rides on the spoken sentinel above.
        if (msg.properties?.name === 'end_interview') this.emit('state', 'complete');
        break;
    }
  }

  async toggleMic(): Promise<void> {
    if (!this.call) return;
    this.call.setLocalAudio(!this.call.localAudio());
  }

  async stop(): Promise<void> {
    const call = this.call;
    this.call = null;
    if (call) {
      try {
        await call.leave();
      } catch {
        /* ignore */
      }
      try {
        await call.destroy();
      } catch {
        /* ignore */
      }
    }
    this.stream = null;
    if (this.videoEl) this.videoEl.srcObject = null;
  }
}
