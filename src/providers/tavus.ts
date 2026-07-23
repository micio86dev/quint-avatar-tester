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
  private completeTimer: ReturnType<typeof setTimeout> | null = null;
  // Opening line echoed once the replica's stream is live (avoids clipped first words that an
  // auto-spoken custom_greeting suffers during WebRTC ramp-up).
  private greeting = '';
  private conversationId?: string;
  private greetingSent = false;

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
    this.greeting = typeof cfg.greeting === 'string' ? cfg.greeting : '';
    this.conversationId = cfg.providerSessionId;

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
    this.maybeGreet();
  }

  // Echo the opening line once, shortly after the first remote track arrives (the replica is
  // present and streaming). Tavus "echo" makes the replica speak the text verbatim.
  private maybeGreet(): void {
    if (this.greetingSent || !this.greeting || !this.call) return;
    this.greetingSent = true;
    const text = this.greeting;
    const conversationId = this.conversationId;
    setTimeout(() => {
      try {
        this.call?.sendAppMessage(
          {
            message_type: 'conversation',
            event_type: 'conversation.echo',
            conversation_id: conversationId,
            properties: { text },
          },
          '*',
        );
      } catch {
        /* best-effort — if echo isn't delivered the interview still proceeds */
      }
    }, 800);
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
          // Avatar spoke the closing sentinel → interview is over. NEVER end immediately: the
          // utterance transcript can arrive before/at the start of the spoken closing line, so
          // completing now would cut off the goodbye and eject the user. Always wait for the
          // replica to STOP speaking; a fallback timer covers the case where the utterance is
          // the last event and no stopped_speaking follows.
          if (role === 'avatar' && matchesEndPhrase(text)) {
            this.pendingComplete = true;
            if (this.completeTimer == null) {
              this.completeTimer = setTimeout(() => {
                if (this.pendingComplete && !this.replicaSpeaking) this.finishComplete();
              }, 8000);
            }
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
        if (this.pendingComplete) this.finishComplete(); // goodbye finished → end now
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

  // Emit 'complete' once, clearing the fallback timer. Guarded so stopped_speaking and the
  // timer can't double-fire it.
  private finishComplete(): void {
    if (!this.pendingComplete) return;
    this.pendingComplete = false;
    if (this.completeTimer != null) {
      clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }
    this.emit('state', 'complete');
  }

  async toggleMic(): Promise<void> {
    if (!this.call) return;
    this.call.setLocalAudio(!this.call.localAudio());
  }

  async stop(): Promise<void> {
    if (this.completeTimer != null) {
      clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }
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
