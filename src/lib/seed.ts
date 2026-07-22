// Idempotent seeder for the interview catalog.
// It splits the legacy questions.json into three managed pieces: one persona prompt
// (general interviewing guidance), one question row per entry, and one default template
// that orders those questions. questions.json will be removed in a later cutover slice;
// for now this is the bridge that turns the file-based script into DB-backed, editable data.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  countTemplates,
  createPrompt,
  createQuestion,
  createTemplate,
  openDb,
  setTemplateQuestions,
} from './db';

interface QuestionsFile {
  language: string;
  title: string;
  intro: string;
  closing: string;
  instructions: string;
  coverageTopics: string[];
  followUpQuestions: string[];
  questions: { id: string; name: string; text: string; objective?: string }[];
}

export interface SeedResult {
  promptsInserted: number;
  questionsInserted: number;
  templatesInserted: number;
}

// Compose the PERSONA body from questions.json — general interviewing guidance only.
// The specific questions are NOT included here; they become their own rows. Content is
// copied verbatim (Italian) — this only formats/concatenates, never rewrites.
function composeBody(q: QuestionsFile): string {
  const aree = q.coverageTopics.map((t) => `- ${t}`).join('\n');
  const approfondimento = q.followUpQuestions.map((f) => `- ${f}`).join('\n');

  return [
    q.instructions,
    '',
    'Aree da coprire',
    aree,
    '',
    'Domande di approfondimento',
    approfondimento,
    '',
    q.closing,
  ].join('\n');
}

// Seed the default prompt, question rows, and default template from questions.json.
// Idempotency is guarded on templates: a virgin DB seeds everything once. A local
// db:reset wipes the file, so no duplicates in practice. We do NOT guard on prompts,
// because a prior slice may already have seeded a prompt independently.
// Accepts an optional connection so callers/tests can reuse an existing DB; otherwise
// opens the app DB (which runs migrations).
export function seed(conn?: Database.Database): SeedResult {
  // openDb is invoked for its migration side-effect; the CRUD helpers use the app's
  // lazily-cached connection, so passing conn here keeps the surface uniform.
  const db = conn ?? openDb();
  void db;

  if (countTemplates() > 0) {
    return { promptsInserted: 0, questionsInserted: 0, templatesInserted: 0 };
  }

  const raw = readFileSync(resolve(process.cwd(), 'questions.json'), 'utf8');
  const q = JSON.parse(raw) as QuestionsFile;

  // 1. Persona prompt (instructions + guidance), no specific questions in the body.
  createPrompt({
    title: q.title,
    body: composeBody(q),
    greeting: q.intro,
    language: q.language,
  });

  // 2. One question row per entry, preserving order for the template membership.
  const questionIds = q.questions.map((item) =>
    createQuestion({
      name: item.name,
      text: item.text,
      objective: item.objective ?? null,
      enabled: true,
    }),
  );

  // 3. Default template that runs those questions in file order. Provider config is
  // left null (omitted) — the operator fills it in later via the CRUD.
  const templateId = createTemplate({
    name: q.title,
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
export type { QuestionsFile };
