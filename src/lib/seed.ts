// Idempotent seeder for the interview catalog.
// Seeds the default managed pieces: one persona PROMPT (interviewing guidance only), the
// ordered default QUESTIONS, and one default TEMPLATE wiring them together. The content
// below is inlined (was formerly read from questions.json) — the Italian strings are the
// seeded interview content; everything else (code, identifiers, comments) stays English.
import Database from 'better-sqlite3';
import {
  countPrompts,
  createPrompt,
  createQuestion,
  createTemplate,
  openDb,
  setTemplateQuestions,
} from './db';

export interface SeedResult {
  promptsInserted: number;
  questionsInserted: number;
  templatesInserted: number;
}

// Default persona metadata (Italian seeded content).
const DEFAULT_LANGUAGE = 'it';
const DEFAULT_TITLE = 'Intervista comportamentale per competenze';
const DEFAULT_GREETING =
  'Ciao! Ti farò alcune domande su situazioni concrete che hai affrontato nel tuo lavoro. Rispondi pure con calma, raccontando episodi reali. Partiamo subito.';

// The interviewing instructions (persona) — copied verbatim from the former questions.json.
const DEFAULT_INSTRUCTIONS =
  "Sei un intervistatore professionale che conduce un colloquio comportamentale strutturato in italiano. Il tuo unico ruolo è facilitare l'intervista e raccogliere un episodio comportamentale reale e valutabile. Non valutare, non interpretare, non riassumere, non dare coaching, non fare complimenti. Mantieni un tono neutro, professionale e colloquiale. Fai una domanda alla volta e lascia che il partecipante completi ogni risposta. Non suggerire possibili risposte. Mantieni la conversazione su un singolo episodio reale e specifico: se il partecipante descrive abitudini generali invece di un episodio, chiedi gentilmente una situazione concreta; se descrive ciò che ha fatto il team, chiedi qual è stato il suo contributo personale.";

// Coverage areas and standardized follow-up questions folded into the persona body.
const DEFAULT_COVERAGE_TOPICS = [
  'Contesto e persone coinvolte',
  'Obiettivo',
  'Azioni personali del partecipante',
  'Difficoltà incontrate',
  'Risultato finale',
];

const DEFAULT_FOLLOW_UP_QUESTIONS = [
  'Qual era il contesto? Chi era coinvolto?',
  "Qual era l'obiettivo?",
  "Cos'hai fatto?",
  'Quali difficoltà hai incontrato?',
  'Qual è stato il risultato?',
];

const DEFAULT_CLOSING =
  'Perfetto, abbiamo raccolto tutto quello che ci serve. Grazie per il tuo tempo!';

// The ordered default questions (name / text / objective), copied verbatim.
const DEFAULT_QUESTIONS: { name: string; text: string; objective: string }[] = [
  {
    name: 'Critical Thinking',
    text: 'Raccontami di un problema complesso recente nella tua area che era difficile da inquadrare. Qual era il problema? Che cosa hai fatto?',
    objective:
      'Raccogliere un episodio reale e specifico che permetta di valutare il pensiero critico del partecipante.',
  },
  {
    name: 'Strategy',
    text: 'Descrivimi un momento recente in cui una priorità strategica importante per la tua area era a rischio. Che cosa era a rischio? Che cosa hai fatto?',
    objective:
      'Raccogliere un episodio reale e specifico che permetta di valutare la capacità strategica del partecipante.',
  },
];

// Compose the PERSONA body from the inlined content — general interviewing guidance only.
// The specific questions are NOT included here; they become their own rows. This only
// formats/concatenates the (Italian) content, never rewrites it.
function composeBody(): string {
  const aree = DEFAULT_COVERAGE_TOPICS.map((t) => `- ${t}`).join('\n');
  const approfondimento = DEFAULT_FOLLOW_UP_QUESTIONS.map((f) => `- ${f}`).join('\n');

  return [
    DEFAULT_INSTRUCTIONS,
    '',
    'Aree da coprire',
    aree,
    '',
    'Domande di approfondimento',
    approfondimento,
    '',
    DEFAULT_CLOSING,
  ].join('\n');
}

// Seed the default prompt, question rows, and default template.
// Idempotency is guarded on prompts: a virgin DB seeds everything once. A local db:reset
// wipes the file, so no duplicates in practice.
// Accepts an optional connection so callers/tests can reuse an existing DB; otherwise
// opens the app DB (which runs migrations).
export function seed(conn?: Database.Database): SeedResult {
  // openDb is invoked for its migration side-effect; the CRUD helpers use the app's
  // lazily-cached connection, so passing conn here keeps the surface uniform.
  const db = conn ?? openDb();
  void db;

  if (countPrompts() > 0) {
    return { promptsInserted: 0, questionsInserted: 0, templatesInserted: 0 };
  }

  // 1. Persona prompt (instructions + guidance), no specific questions in the body.
  createPrompt({
    title: DEFAULT_TITLE,
    body: composeBody(),
    greeting: DEFAULT_GREETING,
    language: DEFAULT_LANGUAGE,
  });

  // 2. One question row per entry, preserving order for the template membership.
  const questionIds = DEFAULT_QUESTIONS.map((item) =>
    createQuestion({
      name: item.name,
      text: item.text,
      objective: item.objective,
      enabled: true,
    }),
  );

  // 3. Default template that runs those questions in order. Provider config is left null
  // (omitted) — the operator fills it in later via the CRUD, otherwise .env is used.
  const templateId = createTemplate({
    name: DEFAULT_TITLE,
    description: null,
    enabled: true,
  });
  setTemplateQuestions(templateId, questionIds);

  return {
    promptsInserted: 1,
    questionsInserted: questionIds.length,
    templatesInserted: 1,
  };
}

// Convenience export for scripts/tests that want the composed body directly.
export { composeBody as composePromptBody };
