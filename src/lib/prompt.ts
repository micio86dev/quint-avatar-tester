// Composes the Italian interviewer context injected into a provider's own LLM. The
// interview runs as ONE continuous conversation covering all of a template's questions in
// order — the avatar asks them one at a time, without stopping between them, and signals
// completion once (after the LAST question) via the provider-specific mechanism.
// Only the avatar's spoken content and the questions are Italian; everything else
// (code, identifiers, comments) stays English.
import { HEYGEN_END_PHRASE } from '../providers/types';

// One question to cover in the interview, in run order.
export interface InterviewQuestion {
  name: string;
  text: string;
  objective: string | null;
}

export interface InterviewPromptParams {
  promptBody: string; // the persona / interviewing instructions (from the prompt row)
  greeting: string; // spoken opening line, verbatim (no baked-in question)
  questions: InterviewQuestion[];
  provider: 'heygen' | 'tavus';
  maxSeconds: number; // resolved session cap, surfaced to keep the avatar on pace
}

// Tavus-only: at the very end of the WHOLE interview the persona calls the end_interview
// tool (registered once on the PAL). It reaches the client as a conversation.tool_call
// app-message and drives the soft auto-advance. HeyGen has no equivalent hook.
const TAVUS_END_TOOL_INSTRUCTION =
  '\n\nQuando hai coperto l’ULTIMA domanda dell’intervista, dopo la tua breve frase ' +
  'di conclusione chiama SUBITO lo strumento end_interview per segnalare che hai finito. ' +
  'Non annunciarlo: chiamalo in silenzio. Chiamalo una sola volta, solo alla fine.';

// HeyGen FULL mode has no tool-calling, so completion is signalled by SPEAKING a fixed
// phrase ONCE, only after the last question is covered. The client (heygen.ts
// matchesEndPhrase) detects it and drives the auto-advance.
const HEYGEN_END_PHRASE_INSTRUCTION =
  '\n\nQuando hai coperto l’ULTIMA domanda dell’intervista, dopo la tua breve frase ' +
  `di conclusione pronuncia ESATTAMENTE, parola per parola, questa frase finale e poi fermati: "${HEYGEN_END_PHRASE}"`;

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// Build a short timezone context preamble to prepend to the persona system prompt so the
// avatar knows the candidate's local date and time without guessing. Returns '' when no
// timezone is known or the timezone is invalid.
export function timezoneContext(tz: string | null): string {
  if (!tz) return '';
  try {
    const localTime = new Date().toLocaleString('it-IT', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'short',
    });
    return `[Contesto temporale]\nFuso orario del candidato: ${tz}. Ora locale: ${localTime}.\n\n`;
  } catch {
    return '';
  }
}

// Compose the Italian context for ONE continuous interview covering every question in the
// template, in order. Returns the system prompt (injected as the provider context) and the
// spoken greeting (opening line, no baked-in question). The provider-specific completion
// instruction is appended ONCE for the whole interview.
export function composeInterviewPrompt(params: InterviewPromptParams): {
  systemPrompt: string;
  greeting: string;
} {
  const { promptBody, greeting, questions, provider, maxSeconds } = params;

  const lines: string[] = [promptBody, '', 'Domande dell’intervista (in questo ordine):'];

  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.text}`);
    if (q.objective && q.objective.trim()) {
      lines.push(`   Obiettivo: ${q.objective.trim()}`);
    }
  });

  lines.push(
    '',
    'Conduci queste domande in sequenza in UNA SOLA conversazione continua, una alla volta, ' +
      'senza fermarti tra una e l’altra. Passa alla domanda successiva solo dopo aver ' +
      'raccolto l’obiettivo di quella corrente. Non ripetere l’elenco delle domande e ' +
      'non chiedere se il partecipante è pronto: attendi le sue risposte.',
    '',
    `Hai a disposizione circa ${mmss(maxSeconds)} in totale: gestisci il tempo, vai al punto e non divagare.`,
  );

  let systemPrompt = lines.join('\n');
  systemPrompt +=
    provider === 'heygen' ? HEYGEN_END_PHRASE_INSTRUCTION : TAVUS_END_TOOL_INSTRUCTION;

  return { systemPrompt, greeting };
}
