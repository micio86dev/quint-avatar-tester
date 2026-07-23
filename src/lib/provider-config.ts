// provider-config.ts — the single source of truth for HeyGen / Tavus template config.
//
// The admin UI (templates.astro), the admin API routes, and the Tavus PAL manager all
// import these specs so labels, constraints, validation, and the Tavus persona mapping
// never drift apart. Pure TS (no astro:env, no DOM) so it is importable from both the
// client <script> of an .astro page and server API routes.

export type FieldType = 'text' | 'number' | 'select' | 'checkbox';
export type Provider = 'heygen' | 'tavus';

export interface FieldSpec {
  key: string;
  type: FieldType;
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  /** Required for the interview to actually run (may still fall back to .env at runtime). */
  required?: boolean;
  /** i18n key for the field label. */
  labelKey: string;
  /** i18n key for the field hint (help text). */
  hintKey?: string;
  /**
   * JSON Pointer (relative to the PAL body) for Tavus persona-level knobs that are applied
   * by creating/patching a Tavus PAL. Fields WITHOUT palPath are conversation-level and are
   * consumed directly in the interview start route.
   */
  palPath?: string;
}

// Shared language selector — both providers expose it/en. Tavus needs its own wording
// ('italian'/'english'); the interview start route maps it/en → Tavus values.
const LANGUAGES = ['it', 'en'] as const;

export const HEYGEN_FIELDS: readonly FieldSpec[] = [
  { key: 'avatarId', type: 'text', required: true, labelKey: 'admin.cfg.avatarId', hintKey: 'admin.cfg.avatarId.hint' },
  { key: 'voiceId', type: 'text', required: true, labelKey: 'admin.cfg.voiceId', hintKey: 'admin.cfg.voiceId.hint' },
  { key: 'language', type: 'select', options: LANGUAGES, labelKey: 'admin.cfg.language', hintKey: 'admin.cfg.language.hint.heygen' },
  { key: 'interactivityType', type: 'select', options: ['CONVERSATIONAL', 'PUSH_TO_TALK'], labelKey: 'admin.cfg.interactivityType', hintKey: 'admin.cfg.interactivityType.hint' },
  { key: 'maxSessionDurationSec', type: 'number', min: 30, max: 3600, labelKey: 'admin.cfg.maxSessionDurationSec', hintKey: 'admin.cfg.maxSessionDurationSec.hint' },
  { key: 'videoQuality', type: 'select', options: ['very_high', 'high', 'medium', 'low'], labelKey: 'admin.cfg.videoQuality', hintKey: 'admin.cfg.videoQuality.hint' },
  { key: 'videoEncoding', type: 'select', options: ['H264', 'VP8'], labelKey: 'admin.cfg.videoEncoding', hintKey: 'admin.cfg.videoEncoding.hint' },
  { key: 'voiceProvider', type: 'select', options: ['elevenLabs', 'fish'], labelKey: 'admin.cfg.voiceProvider', hintKey: 'admin.cfg.voiceProvider.hint' },
  { key: 'voiceSpeed', type: 'number', min: 0.8, max: 1.2, step: 0.01, labelKey: 'admin.cfg.voiceSpeed', hintKey: 'admin.cfg.voiceSpeed.hint' },
  { key: 'voiceStability', type: 'number', min: 0, max: 1, step: 0.01, labelKey: 'admin.cfg.voiceStability', hintKey: 'admin.cfg.voiceStability.hint' },
  { key: 'voiceSimilarityBoost', type: 'number', min: 0, max: 1, step: 0.01, labelKey: 'admin.cfg.voiceSimilarityBoost', hintKey: 'admin.cfg.voiceSimilarityBoost.hint' },
  { key: 'voiceStyle', type: 'number', min: 0, max: 1, step: 0.01, labelKey: 'admin.cfg.voiceStyle', hintKey: 'admin.cfg.voiceStyle.hint' },
  { key: 'voiceUseSpeakerBoost', type: 'checkbox', labelKey: 'admin.cfg.voiceUseSpeakerBoost', hintKey: 'admin.cfg.voiceUseSpeakerBoost.hint' },
] as const;

export const TAVUS_FIELDS: readonly FieldSpec[] = [
  { key: 'faceId', type: 'text', required: true, labelKey: 'admin.cfg.faceId', hintKey: 'admin.cfg.faceId.hint' },
  { key: 'palId', type: 'text', required: true, labelKey: 'admin.cfg.palId', hintKey: 'admin.cfg.palId.hint' },
  { key: 'language', type: 'select', options: LANGUAGES, labelKey: 'admin.cfg.language', hintKey: 'admin.cfg.language.hint.tavus' },
  { key: 'audioOnly', type: 'checkbox', labelKey: 'admin.cfg.audioOnly', hintKey: 'admin.cfg.audioOnly.hint' },
  { key: 'maxCallDurationSec', type: 'number', min: 30, max: 3600, labelKey: 'admin.cfg.maxCallDurationSec', hintKey: 'admin.cfg.maxCallDurationSec.hint' },
  { key: 'participantAbsentTimeoutSec', type: 'number', min: 10, max: 3600, labelKey: 'admin.cfg.participantAbsentTimeoutSec', hintKey: 'admin.cfg.participantAbsentTimeoutSec.hint' },
  { key: 'enableRecording', type: 'checkbox', labelKey: 'admin.cfg.enableRecording', hintKey: 'admin.cfg.enableRecording.hint' },
  { key: 'enableClosedCaptions', type: 'checkbox', labelKey: 'admin.cfg.enableClosedCaptions', hintKey: 'admin.cfg.enableClosedCaptions.hint' },
  // Persona-level knobs — applied by creating/patching a Tavus PAL (see palPath).
  { key: 'llmModel', type: 'select', options: ['tavus-gemma-4', 'tavus-gemma-4-thinking', 'tavus-gpt-5.6-sol', 'tavus-gpt-5.6-terra', 'tavus-gemini-2.5-flash'], labelKey: 'admin.cfg.llmModel', hintKey: 'admin.cfg.llmModel.hint', palPath: 'layers/llm/model' },
  { key: 'llmTemperature', type: 'number', min: 0, max: 2, step: 0.01, labelKey: 'admin.cfg.llmTemperature', hintKey: 'admin.cfg.llmTemperature.hint', palPath: 'layers/llm/extra_body/temperature' },
  { key: 'llmSpeculativeInference', type: 'checkbox', labelKey: 'admin.cfg.llmSpeculativeInference', hintKey: 'admin.cfg.llmSpeculativeInference.hint', palPath: 'layers/llm/speculative_inference' },
  { key: 'ttsEngine', type: 'select', options: ['tavus-auto', 'cartesia', 'elevenlabs', 'azure'], labelKey: 'admin.cfg.ttsEngine', hintKey: 'admin.cfg.ttsEngine.hint', palPath: 'layers/tts/tts_engine' },
  { key: 'ttsExternalVoiceId', type: 'text', labelKey: 'admin.cfg.ttsExternalVoiceId', hintKey: 'admin.cfg.ttsExternalVoiceId.hint', palPath: 'layers/tts/external_voice_id' },
  { key: 'turnTakingPatience', type: 'select', options: ['low', 'medium', 'high'], labelKey: 'admin.cfg.turnTakingPatience', hintKey: 'admin.cfg.turnTakingPatience.hint', palPath: 'layers/conversational_flow/turn_taking_patience' },
  { key: 'interruptibility', type: 'select', options: ['low', 'medium', 'high'], labelKey: 'admin.cfg.interruptibility', hintKey: 'admin.cfg.interruptibility.hint', palPath: 'layers/conversational_flow/pal_interruptibility' },
  { key: 'voiceIsolation', type: 'select', options: ['near', 'off'], labelKey: 'admin.cfg.voiceIsolation', hintKey: 'admin.cfg.voiceIsolation.hint', palPath: 'layers/conversational_flow/voice_isolation' },
  { key: 'idleEngagement', type: 'select', options: ['off', 'patient', 'eager'], labelKey: 'admin.cfg.idleEngagement', hintKey: 'admin.cfg.idleEngagement.hint', palPath: 'layers/conversational_flow/idle_engagement' },
] as const;

export function fieldsFor(provider: Provider): readonly FieldSpec[] {
  return provider === 'heygen' ? HEYGEN_FIELDS : TAVUS_FIELDS;
}

// ── Validation ────────────────────────────────────────────────────────────────────
export type ConfigErrorCode = 'required' | 'type' | 'range' | 'enum';
export interface ConfigError {
  key: string;
  code: ConfigErrorCode;
}

type Config = Record<string, unknown> | null | undefined;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

// Validate a stored config against its provider spec. Returns one error per offending
// field. An empty array means the config is valid (though possibly incomplete — see the
// `required` flag, reported as code 'required').
export function validateProviderConfig(provider: Provider, config: Config): ConfigError[] {
  const errors: ConfigError[] = [];
  for (const f of fieldsFor(provider)) {
    const v = config?.[f.key];
    if (isBlank(v)) {
      if (f.required) errors.push({ key: f.key, code: 'required' });
      continue; // absent optional field → falls back to defaults, nothing to check
    }
    switch (f.type) {
      case 'checkbox':
        if (typeof v !== 'boolean') errors.push({ key: f.key, code: 'type' });
        break;
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          errors.push({ key: f.key, code: 'type' });
          break;
        }
        if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
          errors.push({ key: f.key, code: 'range' });
        }
        break;
      }
      case 'select':
        if (typeof v !== 'string' || !(f.options ?? []).includes(v)) {
          errors.push({ key: f.key, code: 'enum' });
        }
        break;
      default: // text
        if (typeof v !== 'string') errors.push({ key: f.key, code: 'type' });
    }
  }
  return errors;
}

// ── Tavus PAL mapping ───────────────────────────────────────────────────────────────
// Persona-level knobs are the Tavus fields carrying a palPath. They take effect only by
// creating/patching a Tavus PAL (personas API), not on conversation create.
const PAL_FIELDS = TAVUS_FIELDS.filter((f) => f.palPath);

export function hasPersonaKnobs(config: Config): boolean {
  return PAL_FIELDS.some((f) => !isBlank(config?.[f.key]));
}

// Set a value into a nested object following a JSON-Pointer-style path ("a/b/c").
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

// Build the nested `layers` object for a Tavus PAL create from the config's persona knobs.
export function buildPalLayers(config: Config): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const f of PAL_FIELDS) {
    const v = config?.[f.key];
    if (!isBlank(v)) setPath(root, f.palPath as string, v);
  }
  return (root.layers as Record<string, unknown>) ?? {};
}

// Build RFC-6902 JSON Patch operations to update an existing Tavus PAL from the config's
// persona knobs. Blank fields are skipped (left unchanged on the PAL).
export function buildPalPatchOps(
  config: Config,
): Array<{ op: 'replace'; path: string; value: unknown }> {
  const ops: Array<{ op: 'replace'; path: string; value: unknown }> = [];
  for (const f of PAL_FIELDS) {
    const v = config?.[f.key];
    if (!isBlank(v)) ops.push({ op: 'replace', path: '/' + f.palPath, value: v });
  }
  return ops;
}
