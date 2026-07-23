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

// Completion is signalled the same way for BOTH providers: the avatar SPEAKS a fixed
// closing phrase ONCE, only after the last question is covered. The client detects it in
// the avatar transcript (matchesEndPhrase) and auto-ends the session. HeyGen FULL mode has
// no tool-calling, and Tavus never had the end_interview tool actually registered on the
// persona — so a spoken sentinel is the one mechanism that works on both.
const END_PHRASE_INSTRUCTION =
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
  const { promptBody, greeting, questions, maxSeconds } = params;

  const lines: string[] = [promptBody, '', 'Domande dell’intervista (in questo ordine):'];

  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.text}`);
    if (q.objective && q.objective.trim()) {
      lines.push(`   Obiettivo: ${q.objective.trim()}`);
    }
  });

  lines.push(
    '',
    'Conduci queste domande in sequenza in UNA SOLA conversazione continua, una alla volta. ' +
      'Collega le domande con brevi transizioni naturali, agganciandoti a ciò che il ' +
      'partecipante ha appena detto, così non sembra la lettura di una lista. Passa alla ' +
      'domanda successiva SOLO quando il partecipante ha chiaramente finito di rispondere: ' +
      'non interromperlo e non anticipare mentre sta ancora parlando.',
    '',
    'Adatta le domande di approfondimento a ciò che il partecipante ha appena raccontato: ' +
      'evita formule ripetute e non riproporre più volte la stessa domanda con parole simili. ' +
      'Se il partecipante ti chiede di ripetere o di chiarire una domanda, fallo volentieri e ' +
      'riformulala con parole diverse e più semplici: non rifiutarti mai di ripetere o spiegare.',
    '',
    'Parla con calma e in modo naturale, con brevi pause tra le frasi; non affrettare il ritmo.',
    '',
    `Hai a disposizione circa ${mmss(maxSeconds)} in totale: gestisci il tempo, vai al punto e non divagare.`,
  );

  // Same spoken-sentinel completion mechanism for both providers (see END_PHRASE_INSTRUCTION).
  const systemPrompt = lines.join('\n') + END_PHRASE_INSTRUCTION;

  return { systemPrompt, greeting };
}
