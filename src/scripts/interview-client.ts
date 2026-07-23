// UI state machine for the single continuous avatar interview.
// Screens: start → interview → done. The operator picks a prompt (persona) and a template
// (questions + provider config), then runs ONE timed provider session end-to-end. The
// client owns the countdown, persists every normalized transcript entry, and drives the
// integrity/proctor beaconing and cost meter. It talks ONLY to the InterviewProvider
// interface, so HeyGen and Tavus stay interchangeable.
import type { InterviewProvider, ProviderName, TranscriptEntry } from '../providers/types';
import { HeyGenProvider } from '../providers/heygen';
import { TavusProvider } from '../providers/tavus';
import { beaconProctor, enterFullscreen, setAvatarSpeaking, setViolationCallback, startProctor, stopProctor, warmupCamera } from './proctor';
import { t, type Locale } from '../lib/i18n';

// SSR set <html lang> from the resolved locale; the client mirrors it for all runtime copy.
const locale = (document.documentElement.lang || 'it') as Locale;

type Phase = 'idle' | 'connecting' | 'live';
type Screen = 'start' | 'preview' | 'interview' | 'done';
type EndedReason = 'completed' | 'timeout' | 'user_stop' | 'error';

interface Rates {
  heygenCreditsPerMin: number;
  heygenUsdPerCredit: number;
  tavusUsdPerMin: number;
}
interface PromptOption {
  id: number;
  title: string;
  language?: string;
}
interface TemplateOption {
  id: number;
  name: string;
  enabled: number; // 0/1
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// ── DOM ─────────────────────────────────────────────────────────────────────────
const app = document.getElementById('app') as HTMLElement;
const videoEl = document.getElementById('avatar-video') as HTMLVideoElement;
const avatarViz = document.getElementById('avatar-viz') as HTMLElement;
const button = document.getElementById('talk-button') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;
const captionEl = document.getElementById('caption') as HTMLElement;
const consentEl = document.getElementById('consent') as HTMLInputElement;
const providerRadios = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="provider"]'),
);
// Start screen
const promptSelect = document.getElementById('prompt-select') as HTMLSelectElement;
const templateSelect = document.getElementById('template-select') as HTMLSelectElement;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const startError = document.getElementById('start-error') as HTMLElement;
// Device preview (mic/webcam check before joining)
const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;
const previewMeterFill = document.getElementById('preview-meter-fill') as HTMLElement;
const previewError = document.getElementById('preview-error') as HTMLElement;
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
const btnPreviewCancel = document.getElementById('btn-preview-cancel') as HTMLButtonElement;
// Interview top bar
const timerEl = document.getElementById('timer') as HTMLElement;
// Done screen
const transcriptLink = document.getElementById('transcript-link') as HTMLAnchorElement;
const btnRestart = document.getElementById('btn-restart') as HTMLButtonElement;
// Cost meter
const meterEl = document.getElementById('meter') as HTMLElement;
const meterCostEl = document.getElementById('meter-cost') as HTMLElement;
const meterCreditsEl = document.getElementById('meter-credits') as HTMLElement;
// Toast
const toastEl = document.getElementById('toast') as HTMLElement;
const toastMsgEl = document.getElementById('toast-msg') as HTMLElement;

// ── Remembered picks ────────────────────────────────────────────────────────────────
// Persist the operator's last provider / prompt / template in cookies so a return visit
// starts pre-filled. Prompt/template restore only if the stored id is still a live option.
const PICK_COOKIE = { provider: 'last_provider', prompt: 'last_prompt', template: 'last_template' };
function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}
function savePicks(): void {
  writeCookie(PICK_COOKIE.provider, selectedProvider());
  writeCookie(PICK_COOKIE.prompt, promptSelect.value);
  writeCookie(PICK_COOKIE.template, templateSelect.value);
}
function restorePicks(): void {
  const p = readCookie(PICK_COOKIE.provider);
  if (p === 'heygen' || p === 'tavus') {
    const radio = providerRadios.find((r) => r.value === p);
    if (radio) radio.checked = true;
  }
  const promptId = readCookie(PICK_COOKIE.prompt);
  if (promptId && Array.from(promptSelect.options).some((o) => o.value === promptId)) {
    promptSelect.value = promptId;
  }
  const templateId = readCookie(PICK_COOKIE.template);
  if (templateId && Array.from(templateSelect.options).some((o) => o.value === templateId)) {
    templateSelect.value = templateId;
  }
}

// ── State ─────────────────────────────────────────────────────────────────────────
let provider: InterviewProvider | null = null;
let phase: Phase = 'idle';
let ending = true; // true whenever no live session owns teardown (guards stray stop events)
let providerName: ProviderName = 'heygen';

let sessionId: number | null = null;
let providerSessionId: string | undefined;
// Pre-session camera proximity check. null = unknown/pending, true = OK, false = too far.
let cameraOk: boolean | null = null;
let cameraCheckCleanup: (() => void) | null = null;
let toastTimer: number | null = null;
let rates: Rates = { heygenCreditsPerMin: 2, heygenUsdPerCredit: 0.1, tavusUsdPerMin: 0.37 };

let selectorsReady = false;

// Timer — a single countdown over the whole session.
let timerLimit = 285;
let timerWarn = 60;
let timerDeadline = 0;
let timerInterval: number | null = null;
let nudged = false;

// Client-side auto-retry for Tavus concurrency lag. The free-tier slot is released a few
// seconds after /end; the first start briefly races that window. We retry silently before
// falling back to a manual-retry prompt.
const CLIENT_BUSY_RETRIES = 3;
const CLIENT_BUSY_DELAY_MS = 3000;

// Cost meter
const CREDITS_REPOLL_MS = 60_000;
const CREDITS_LOW = 20;
const CREDITS_CRITICAL = 6;
let meterTimer: number | null = null;
let repollTimer: number | null = null;
let meterStartMs = 0;
let startCredits: number | null = null;

// Maps a status kind to its i18n key and the CSS data-state used for colouring.
const STATUS: Record<string, [string, string]> = {
  idle: ['interview.status.idle', 'idle'],
  connecting: ['interview.status.connecting', 'connecting'],
  ready: ['interview.status.ready', 'ready'],
  listening: ['interview.status.listening', 'listening'],
  speaking: ['interview.status.speaking', 'speaking'],
  stopped: ['interview.status.stopped', 'idle'],
  waiting: ['interview.status.waiting', 'waiting'],
  error: ['interview.status.error', 'error'],
};

// ── Small helpers ─────────────────────────────────────────────────────────────────
function setScreen(name: Screen): void {
  app.dataset.screen = name;
}
function setStatus(kind: string, override?: string): void {
  const [key, state] = STATUS[kind] ?? STATUS.idle;
  statusEl.textContent = override ?? t(locale, key);
  statusEl.dataset.state = state;
}
function selectedProvider(): ProviderName {
  return providerRadios.find((r) => r.checked)?.value === 'tavus' ? 'tavus' : 'heygen';
}
function makeProvider(name: ProviderName): InterviewProvider {
  return name === 'tavus' ? new TavusProvider() : new HeyGenProvider();
}
function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function setButton(): void {
  const live = phase === 'live';
  button.textContent =
    phase === 'connecting' ? t(locale, 'interview.button.connecting') : t(locale, 'interview.button.stop');
  button.dataset.on = String(live);
  button.disabled = phase !== 'live';
}
// The Start button is enabled only once consent is given and both selectors have a value.
function refreshStartEnabled(): void {
  btnStart.disabled =
    !selectorsReady || !consentEl.checked || !promptSelect.value || !templateSelect.value;
}

// ── Selector population ───────────────────────────────────────────────────────────
async function loadSelectors(): Promise<void> {
  promptSelect.disabled = true;
  templateSelect.disabled = true;
  let prompts: PromptOption[] = [];
  let templates: TemplateOption[] = [];
  try {
    const [pRes, tRes] = await Promise.all([
      fetch('/api/admin/prompts'),
      fetch('/api/admin/templates'),
    ]);
    prompts = pRes.ok ? ((await pRes.json().catch(() => [])) as PromptOption[]) : [];
    templates = tRes.ok ? ((await tRes.json().catch(() => [])) as TemplateOption[]) : [];
  } catch {
    prompts = [];
    templates = [];
  }
  const enabledTemplates = (Array.isArray(templates) ? templates : []).filter(
    (t) => t.enabled === 1,
  );
  const validPrompts = Array.isArray(prompts) ? prompts : [];

  if (validPrompts.length === 0 || enabledTemplates.length === 0) {
    selectorsReady = false;
    promptSelect.innerHTML = '<option value="">—</option>';
    templateSelect.innerHTML = '<option value="">—</option>';
    startError.textContent = t(locale, 'interview.error.no_config');
    refreshStartEnabled();
    return;
  }

  promptSelect.innerHTML =
    `<option value="">${escapeHtml(t(locale, 'interview.select.prompt_placeholder'))}</option>` +
    validPrompts
      .map(
        (p) =>
          `<option value="${p.id}">${escapeHtml(p.title)}${p.language ? ` (${escapeHtml(p.language)})` : ''}</option>`,
      )
      .join('');
  templateSelect.innerHTML =
    `<option value="">${escapeHtml(t(locale, 'interview.select.template_placeholder'))}</option>` +
    enabledTemplates
      .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
      .join('');

  promptSelect.disabled = false;
  templateSelect.disabled = false;
  selectorsReady = true;
  startError.textContent = '';
  restorePicks();
  refreshStartEnabled();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Timer ───────────────────────────────────────────────────────────────────────
function startTimer(limitSeconds: number, warnSeconds: number): void {
  clearTimer();
  timerLimit = limitSeconds > 0 ? limitSeconds : timerLimit;
  timerWarn = warnSeconds > 0 ? warnSeconds : timerWarn;
  timerDeadline = Date.now() + timerLimit * 1000;
  nudged = false;
  renderTimer();
  timerInterval = window.setInterval(renderTimer, 500);
}
function renderTimer(): void {
  const remaining = Math.max(0, (timerDeadline - Date.now()) / 1000);
  timerEl.textContent = mmss(Math.ceil(remaining));
  timerEl.dataset.warn = remaining <= 15 ? 'critical' : remaining <= timerWarn ? 'warn' : 'normal';
  // Optional wrap-up nudge ~20s before zero (HeyGen only; Tavus has a server hard cap).
  // Session-scoped: fired once.
  if (!nudged && remaining <= 20 && remaining > 0 && providerName === 'heygen') {
    nudged = true;
    provider?.nudgeWrapUp?.();
  }
  if (remaining <= 0) void onTimeout();
}
function clearTimer(): void {
  if (timerInterval != null) window.clearInterval(timerInterval);
  timerInterval = null;
}
function resetTimerDisplay(): void {
  clearTimer();
  timerEl.textContent = '—:——';
  timerEl.dataset.warn = 'normal';
}

// ── Toast notifications ────────────────────────────────────────────────────────
// Types that warrant a visible in-interview warning (not looking_away — too frequent).
const TOAST_TYPES = new Set(['tab_hidden','focus_lost','fullscreen_exit','clipboard_copy','clipboard_paste','face_absent','multiple_faces','looking_down','too_far','phone_detected']);

function showToast(type: string, label: string): void {
  if (!TOAST_TYPES.has(type)) return;
  toastMsgEl.textContent = `⚠ ${label}`;
  toastEl.hidden = false;
  if (toastTimer != null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 4000);
}

// ── Cost meter ─────────────────────────────────────────────────────────────────
async function fetchCredits(): Promise<number | null> {
  try {
    const res = await fetch('/api/credits');
    const data = await res.json().catch(() => null);
    return res.ok && typeof data?.credits_left === 'number' ? data.credits_left : null;
  } catch {
    return null;
  }
}
function elapsedMin(): number {
  return (Date.now() - meterStartMs) / 60_000;
}
function renderMeter(): void {
  const min = elapsedMin();
  let costUsd: number;
  if (providerName === 'heygen') {
    const consumed = min * rates.heygenCreditsPerMin;
    costUsd = consumed * rates.heygenUsdPerCredit;
    if (startCredits != null) {
      const remaining = Math.max(0, startCredits - consumed);
      meterCreditsEl.textContent = t(locale, 'interview.meter.credits', { n: remaining.toFixed(1) });
      meterCreditsEl.dataset.low =
        remaining <= CREDITS_CRITICAL ? 'critical' : remaining <= CREDITS_LOW ? 'true' : 'false';
    } else {
      meterCreditsEl.textContent = t(locale, 'interview.meter.credits_delta', { n: consumed.toFixed(1) });
      meterCreditsEl.dataset.low = 'false';
    }
    meterCreditsEl.hidden = false;
  } else {
    // Tavus: no balance API → estimate from elapsed minutes (30s minimum, round up to 6s).
    const billedMin = Math.max(0.5, Math.ceil(min * 600) / 600);
    costUsd = billedMin * rates.tavusUsdPerMin;
    meterCreditsEl.hidden = true;
  }
  meterCostEl.textContent = `${providerName === 'tavus' ? 'est.' : '≈'} $${costUsd.toFixed(2)}`;
}
async function anchorCredits(): Promise<void> {
  if (providerName !== 'heygen') return;
  const real = await fetchCredits();
  if (real == null) return;
  if (startCredits == null) {
    startCredits = real;
    meterStartMs = Date.now();
  } else {
    const est = startCredits - elapsedMin() * rates.heygenCreditsPerMin;
    if (real < est) {
      startCredits = real;
      meterStartMs = Date.now();
    }
  }
  renderMeter();
}
function startMeter(pricing?: Rates): void {
  if (pricing) rates = pricing;
  meterStartMs = Date.now();
  startCredits = null;
  meterEl.removeAttribute('hidden');
  renderMeter();
  void anchorCredits();
  meterTimer = window.setInterval(renderMeter, 1000);
  repollTimer = window.setInterval(() => void anchorCredits(), CREDITS_REPOLL_MS);
}
function stopMeter(): void {
  if (meterTimer != null) window.clearInterval(meterTimer);
  if (repollTimer != null) window.clearInterval(repollTimer);
  meterTimer = null;
  repollTimer = null;
  startCredits = null;
  meterEl.setAttribute('hidden', '');
}

// ── Persistence ──────────────────────────────────────────────────────────────────
async function persist(entry: TranscriptEntry): Promise<void> {
  if (sessionId == null) return;
  try {
    await fetch('/api/interview/utterance', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId, ...entry }),
    });
  } catch {
    /* best-effort; HeyGen reconciles at end anyway */
  }
}

// ── Session lifecycle ─────────────────────────────────────────────────────────────
async function ensureMicPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

// Step 1 — validate the picks, then open the device preview so the operator can check the
// webcam framing and the mic level BEFORE the provider session (and its cost) start.
async function startSession(): Promise<void> {
  if (phase !== 'idle') return;
  startError.textContent = '';

  const promptId = Number(promptSelect.value);
  const templateId = Number(templateSelect.value);
  if (!consentEl.checked || !promptId || !templateId) {
    startError.textContent = t(locale, 'interview.error.select_all');
    return;
  }
  providerName = selectedProvider();
  await openPreview();
}

// ── Device preview (mic + webcam check) ───────────────────────────────────────────
let previewStream: MediaStream | null = null;
let previewMeterRaf: number | null = null;
let previewAudioCtx: AudioContext | null = null;

async function openPreview(): Promise<void> {
  previewError.textContent = '';
  btnJoin.disabled = true;
  setScreen('preview');
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true,
    });
  } catch {
    previewError.textContent = t(locale, 'interview.error.devices_denied');
    return;
  }
  previewVideo.srcObject = previewStream;
  previewVideo.muted = true;
  void previewVideo.play().catch(() => {});
  startPreviewMeter(previewStream);
  btnJoin.disabled = false;
}

// Live mic level bar off the preview stream — WebAudio peak of the time-domain signal.
function startPreviewMeter(stream: MediaStream): void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC || stream.getAudioTracks().length === 0) return;
  previewAudioCtx = new AC();
  const analyser = previewAudioCtx.createAnalyser();
  analyser.fftSize = 512;
  previewAudioCtx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const tick = (): void => {
    // stopPreview() nulls the stream + closes the context; bail so we never read a closed one.
    if (!previewStream || !previewAudioCtx) return;
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    // Scale up a bit so normal speech fills a good chunk of the bar; clamp to 100%.
    previewMeterFill.style.width = Math.min(100, Math.round(peak * 180)) + '%';
    previewMeterRaf = requestAnimationFrame(tick);
  };
  tick();
}

// Release the preview devices + meter. The session re-acquires fresh streams on join, so we
// never hand a preview stream into the proctor/provider (keeps ownership simple).
function stopPreview(): void {
  if (previewMeterRaf != null) cancelAnimationFrame(previewMeterRaf);
  previewMeterRaf = null;
  if (previewAudioCtx) {
    void previewAudioCtx.close().catch(() => {});
    previewAudioCtx = null;
  }
  if (previewStream) {
    previewStream.getTracks().forEach((tr) => tr.stop());
    previewStream = null;
  }
  previewVideo.srcObject = null;
  previewMeterFill.style.width = '0%';
}

// Step 2 — the operator confirmed the devices: release the preview and connect for real.
async function connectSession(): Promise<void> {
  if (phase !== 'idle') return;
  stopPreview();

  const promptId = Number(promptSelect.value);
  const templateId = Number(templateSelect.value);
  providerName = selectedProvider();

  // Move to the interview screen and run the pre-session camera warmup.
  enterInterviewScreen();
  void enterFullscreen();

  if (cameraOk === false) {
    setStatus('waiting', t(locale, 'interview.waiting.move_closer'));
    // The warmup callback re-triggers connect once the face is close enough is not
    // automatic here — the operator restarts via Stop → Start another. Keep it simple:
    // proceed anyway (null/false only delays, never blocks the test tool).
  }

  phase = 'connecting';
  setButton();
  setStatus('connecting');

  try {
    await ensureMicPermission();
  } catch {
    setStatus('error', t(locale, 'interview.error.mic_denied'));
    await teardown('error');
    goHome();
    return;
  }

  try {
    // Retry loop for Tavus concurrency lag — the free-tier slot is released a few seconds
    // after /end and the server already retries internally, but sometimes that budget runs
    // out first. We retry silently on the client so the operator never has to click again.
    let res!: Response;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = null;
    for (let busyAttempt = 0; ; busyAttempt++) {
      res = await fetch('/api/interview/start', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          promptId,
          templateId,
          provider: providerName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      data = await res.json().catch(() => null);
      const busy = res.status === 429 || data?.code === 'provider_busy';
      if (!busy || busyAttempt >= CLIENT_BUSY_RETRIES) break;
      setStatus('waiting');
      await new Promise<void>((r) => setTimeout(r, CLIENT_BUSY_DELAY_MS));
      setStatus('connecting');
    }
    if (res.status === 429 || data?.code === 'provider_busy') {
      const busyMsg = data?.error ?? t(locale, 'interview.error.provider_busy');
      setStatus('error', busyMsg);
      await teardown('error');
      goHome();
      startError.textContent = busyMsg;
      return;
    }
    if (!res.ok || !data?.dbSessionId) throw new Error(data?.error ?? `start HTTP ${res.status}`);

    sessionId = data.dbSessionId;
    providerSessionId = data.providerSessionId ?? undefined;
    // Tavus audio_only sends no video track (the element would show a green frame), so show
    // the visualizer instead. HeyGen and video Tavus keep the <video>.
    applyAudioOnly(Boolean(data.audioOnly));

    provider = makeProvider(providerName);
    ending = false;
    provider.on('transcript', (p) => {
      const entry = p as TranscriptEntry;
      const who = t(locale, entry.role === 'avatar' ? 'interview.speaker.avatar' : 'interview.speaker.you');
      captionEl.textContent = `${who}: ${entry.text}`;
      void persist(entry);
    });
    provider.on('state', (s) => {
      const kind = String(s);
      setAvatarSpeaking(kind === 'speaking');
      avatarViz.classList.toggle('speaking', kind === 'speaking'); // drives the audio-only bars
      if (kind === 'stopped') {
        if (!ending) void onProviderStopped();
        return;
      }
      if (kind === 'complete') {
        if (!ending) void onComplete();
        return;
      }
      setStatus(kind);
    });
    provider.on('error', (e) => {
      if (ending) return;
      setStatus('error', t(locale, 'interview.status.error_prefix', { msg: String(e) }));
      void onProviderError();
    });

    const result = await provider.start(videoEl, {
      dbSessionId: sessionId!,
      providerSessionId,
      sessionToken: data.sessionToken,
      conversationUrl: data.conversationUrl,
    });
    providerSessionId = result.providerSessionId ?? providerSessionId;

    phase = 'live';
    setButton();
    startMeter(data.pricing as Rates | undefined);
    startTimer(
      Number(data.sessionMaxSeconds) > 0 ? Number(data.sessionMaxSeconds) : timerLimit,
      Number(data.warnSeconds) > 0 ? Number(data.warnSeconds) : timerWarn,
    );
    startProctor(sessionId!); // soft, silent integrity collector (provider-agnostic)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('error', t(locale, 'interview.status.error_prefix', { msg }));
    await teardown('error');
    goHome();
    startError.textContent = msg;
  }
}

// Ends the provider session, marks the DB row ended (reconciling HeyGen's transcript,
// freeing the Tavus slot). Does NOT change the screen — callers decide where to go next.
// `ending` guards against re-entrant stop events.
async function teardown(reason: EndedReason): Promise<void> {
  if (ending) return;
  ending = true;
  clearTimer();
  stopMeter();
  cameraCheckCleanup?.(); // safety net: stop warmup if not already cleaned up
  cameraCheckCleanup = null;
  cameraOk = null;
  stopProctor(); // flush + release camera; captured its own sessionId at start

  const p = provider;
  const sid = sessionId;
  const psid = providerSessionId;
  const name = providerName;
  provider = null;
  sessionId = null;

  if (p) {
    try {
      await p.stop();
    } catch {
      /* already down */
    }
  }
  if (sid != null) {
    try {
      await fetch('/api/interview/end', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ sessionId: sid, provider: name, providerSessionId: psid, endedReason: reason }),
      });
    } catch {
      /* best-effort */
    }
  }
  phase = 'idle';
}

// The three end conditions for the single session.
async function onTimeout(): Promise<void> {
  if (phase !== 'live') return;
  clearTimer();
  const sid = sessionId;
  setStatus('error', t(locale, 'interview.time_up'));
  await teardown('timeout');
  showDone(sid);
}
async function onProviderStopped(): Promise<void> {
  const sid = sessionId;
  await teardown('user_stop');
  showDone(sid);
}
// The avatar concluded the interview itself (HeyGen end phrase / Tavus end_interview tool).
async function onComplete(): Promise<void> {
  if (ending) return;
  const sid = sessionId;
  await teardown('completed');
  showDone(sid);
}
async function onProviderError(): Promise<void> {
  const sid = sessionId;
  await teardown('error');
  showDone(sid);
}

// ── Screen flow ────────────────────────────────────────────────────────────────
// Audio-only (Tavus audio_only templates): swap the green, track-less <video> for the
// animated visualizer. The <video> stays in the DOM (display:none) so its audio keeps playing.
function applyAudioOnly(on: boolean): void {
  videoEl.classList.toggle('audio-only', on);
  avatarViz.hidden = !on;
  if (!on) avatarViz.classList.remove('speaking');
}

function enterInterviewScreen(): void {
  // Stop any previous proximity check before starting a fresh one.
  cameraCheckCleanup?.();
  cameraCheckCleanup = null;
  cameraOk = null;

  captionEl.textContent = '';
  resetTimerDisplay();
  applyAudioOnly(false); // default to video; the start response flips this on if audio_only
  setStatus('connecting');
  setScreen('interview');

  // Background camera warmup: opens the webcam preview so the operator can adjust position.
  // It never blocks the session in this test tool — result is advisory only.
  cameraCheckCleanup = warmupCamera((ok) => {
    cameraOk = ok;
  });
}

function showDone(sid: number | null): void {
  if (sid != null) {
    transcriptLink.href = `/review/${sid}`;
    transcriptLink.hidden = false;
  } else {
    transcriptLink.hidden = true;
  }
  setScreen('done');
}

function goHome(): void {
  cameraCheckCleanup?.();
  cameraCheckCleanup = null;
  cameraOk = null;
  stopPreview(); // safety net if we bail out of the preview screen
  captionEl.textContent = '';
  applyAudioOnly(false);
  resetTimerDisplay();
  phase = 'idle';
  ending = true;
  setButton();
  setScreen('start');
  refreshStartEnabled();
}

// ── Wiring ───────────────────────────────────────────────────────────────────────
button.addEventListener('click', () => {
  if (phase === 'live') {
    // Capture the session id BEFORE teardown clears it, so the done screen's
    // transcript link still works after a manual stop.
    const sid = sessionId;
    void teardown('user_stop').then(() => showDone(sid));
  }
});
btnStart.addEventListener('click', () => void startSession());
btnJoin.addEventListener('click', () => void connectSession());
btnPreviewCancel.addEventListener('click', () => {
  stopPreview();
  goHome();
});
btnRestart.addEventListener('click', goHome);
consentEl.addEventListener('change', refreshStartEnabled);
promptSelect.addEventListener('change', refreshStartEnabled);
templateSelect.addEventListener('change', refreshStartEnabled);
// Remember the last provider / prompt / template picks across visits.
providerRadios.forEach((r) => r.addEventListener('change', savePicks));
promptSelect.addEventListener('change', savePicks);
templateSelect.addEventListener('change', savePicks);

setViolationCallback(showToast);

// On tab/window close, end a live Tavus conversation server-side. A local provider.stop()
// only leaves the Daily room and may not transmit during unload, so the single Tavus slot
// (and its billing) would linger until max_call_duration. sendBeacon reliably delivers the
// end request to our own server, which then fires the Tavus REST /end and frees the slot at
// once. HeyGen is intentionally left untouched (no behavior change outside Tavus).
let unloadHandled = false;
function releaseOnUnload(): void {
  if (unloadHandled) return;
  unloadHandled = true;
  stopPreview(); // release preview devices if the page closes while on the preview screen
  beaconProctor(); // ship any buffered integrity events before the page goes away
  if (providerName === 'tavus' && sessionId != null && !ending) {
    const payload = JSON.stringify({
      sessionId,
      provider: 'tavus',
      providerSessionId,
      endedReason: 'user_stop',
    });
    navigator.sendBeacon('/api/interview/end', new Blob([payload], { type: 'application/json' }));
  }
  provider?.stop().catch(() => {});
}
// pagehide is the reliable unload signal (bfcache/mobile); beforeunload covers desktop close.
window.addEventListener('pagehide', releaseOnUnload);
window.addEventListener('beforeunload', releaseOnUnload);

// Initial UI.
setScreen('start');
setButton();
void loadSelectors();
