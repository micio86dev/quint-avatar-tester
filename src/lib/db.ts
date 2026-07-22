// Local SQLite persistence for interviews.
// A single better-sqlite3 connection is opened lazily on first use and reused for the
// lifetime of the Node process (the app runs under @astrojs/node standalone locally).
// The schema is applied via versioned migrations on boot. DB file lives at ./data/interviews.db.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runMigrations } from './migrate';
import {
  summarizeIntegrity,
  type IntegrityEventInput,
  type IntegritySummary,
} from './proctor-config';

export type { IntegrityEventInput, IntegritySummary } from './proctor-config';

export type Role = 'user' | 'avatar';
export type ProgressStatus = 'pending' | 'completed' | 'timeout' | 'skipped';
export type EndedReason = 'completed' | 'timeout' | 'user_stop' | 'error';

export interface SessionRow {
  id: number;
  provider: string;
  provider_session_id: string | null;
  questions_version: string | null;
  candidate_id: number | null;
  question_id: string | null;
  question_index: number | null;
  ended_reason: string | null;
  started_at: string;
  ended_at: string | null;
  timezone: string | null; // IANA timezone from the user's browser (e.g. "Europe/Rome")
  provider_meta: string | null; // JSON blob of post-session data fetched from provider API
}

export interface UtteranceRow {
  id: number;
  session_id: number;
  role: Role;
  text: string;
  seq: number | null;
  created_at: string;
}

export interface UtteranceInput {
  role: Role;
  text: string;
  seq?: number | null;
  createdAt?: string;
}

export interface CandidateRow {
  id: number;
  display_name: string | null;
  resume_code: string;
  created_at: string;
}

export interface ProgressRow {
  id: number;
  candidate_id: number;
  question_id: string | null;
  question_index: number;
  status: ProgressStatus;
  session_id: number | null;
  answer_summary: string | null;
  updated_at: string;
}

export interface SessionMeta {
  candidateId?: number;
  questionId?: string;
  questionIndex?: number;
  timezone?: string;
}

export interface IntegrityEventRow {
  id: number;
  session_id: number;
  type: string;
  meta: string | null; // JSON string
  ts: string;
  created_at: string;
}

// DB file location. Defaults to ./data/interviews.db for local dev. In deployed
// environments where the working directory is ephemeral (e.g. a Railway service),
// set DATABASE_PATH to a file on a mounted persistent volume so data survives restarts.
const DB_PATH = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : resolve(process.cwd(), 'data', 'interviews.db');

// Exported so runnable scripts (db-migrate/db-seed) resolve the same file without
// duplicating the DATABASE_PATH logic.
export function getDbPath(): string {
  return DB_PATH;
}

let db: Database.Database | null = null;

// Open the DB, set pragmas, and bring the schema up to date via the migration runner.
// Exported so scripts can open the exact same connection surface the app uses.
export function openDb(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  runMigrations(conn);
  return conn;
}

function getDb(): Database.Database {
  if (db) return db;
  db = openDb();
  return db;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
export function createSession(
  provider: string,
  providerSessionId: string | null,
  questionsVersion: string | null,
  meta: SessionMeta = {},
): number {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO sessions
         (provider, provider_session_id, questions_version, candidate_id, question_id, question_index, timezone, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      provider,
      providerSessionId,
      questionsVersion,
      meta.candidateId ?? null,
      meta.questionId ?? null,
      meta.questionIndex ?? null,
      meta.timezone ?? null,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function endSession(
  sessionId: number,
  providerSessionId?: string | null,
  endedReason?: EndedReason | null,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE sessions
         SET ended_at = ?,
             provider_session_id = COALESCE(?, provider_session_id),
             ended_reason = COALESCE(?, ended_reason)
       WHERE id = ?`,
    )
    .run(now, providerSessionId ?? null, endedReason ?? null, sessionId);
}

export function setProviderMeta(sessionId: number, meta: Record<string, unknown>): void {
  getDb()
    .prepare(`UPDATE sessions SET provider_meta = ? WHERE id = ?`)
    .run(JSON.stringify(meta), sessionId);
}

export function getSession(sessionId: number): SessionRow | undefined {
  return getDb().prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | SessionRow
    | undefined;
}

// ── Utterances ────────────────────────────────────────────────────────────────
export function insertUtterance(sessionId: number, u: UtteranceInput): void {
  getDb()
    .prepare(
      `INSERT INTO utterances (session_id, role, text, seq, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, u.role, u.text, u.seq ?? null, u.createdAt ?? new Date().toISOString());
}

// Reconcile: drop the live-captured rows for a session and replace them with an
// authoritative set (used for HeyGen, whose server transcript is the source of truth).
export function replaceUtterances(sessionId: number, rows: UtteranceInput[]): void {
  const conn = getDb();
  const del = conn.prepare(`DELETE FROM utterances WHERE session_id = ?`);
  const ins = conn.prepare(
    `INSERT INTO utterances (session_id, role, text, seq, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = conn.transaction((items: UtteranceInput[]) => {
    del.run(sessionId);
    items.forEach((u, i) => {
      ins.run(sessionId, u.role, u.text, u.seq ?? i, u.createdAt ?? new Date().toISOString());
    });
  });
  tx(rows);
}

export function getUtterances(sessionId: number): UtteranceRow[] {
  return getDb()
    .prepare(`SELECT * FROM utterances WHERE session_id = ? ORDER BY COALESCE(seq, id), id`)
    .all(sessionId) as UtteranceRow[];
}

// ── Candidates & progress ───────────────────────────────────────────────────────
export function createCandidate(displayName: string | null, resumeCode: string): number {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(`INSERT INTO candidates (display_name, resume_code, created_at) VALUES (?, ?, ?)`)
    .run(displayName, resumeCode, now);
  return Number(info.lastInsertRowid);
}

// Seed one 'pending' progress row per question, in order (atomic).
export function seedProgress(
  candidateId: number,
  questions: { id: string }[],
): void {
  const conn = getDb();
  const now = new Date().toISOString();
  const ins = conn.prepare(
    `INSERT INTO question_progress
       (candidate_id, question_id, question_index, status, session_id, answer_summary, updated_at)
     VALUES (?, ?, ?, 'pending', NULL, NULL, ?)`,
  );
  const tx = conn.transaction((items: { id: string }[]) => {
    items.forEach((q, i) => ins.run(candidateId, q.id, i, now));
  });
  tx(questions);
}

export function getCandidateByCode(code: string): CandidateRow | undefined {
  return getDb().prepare(`SELECT * FROM candidates WHERE resume_code = ?`).get(code) as
    | CandidateRow
    | undefined;
}

export function getCandidateById(id: number): CandidateRow | undefined {
  return getDb().prepare(`SELECT * FROM candidates WHERE id = ?`).get(id) as
    | CandidateRow
    | undefined;
}

export function getProgress(candidateId: number): ProgressRow[] {
  return getDb()
    .prepare(`SELECT * FROM question_progress WHERE candidate_id = ? ORDER BY question_index`)
    .all(candidateId) as ProgressRow[];
}

export function setProgressStatus(
  candidateId: number,
  questionIndex: number,
  status: ProgressStatus,
): void {
  getDb()
    .prepare(
      `UPDATE question_progress SET status = ?, updated_at = ?
       WHERE candidate_id = ? AND question_index = ?`,
    )
    .run(status, new Date().toISOString(), candidateId, questionIndex);
}

export function setProgressSession(
  candidateId: number,
  questionIndex: number,
  sessionId: number,
): void {
  getDb()
    .prepare(
      `UPDATE question_progress SET session_id = ?, updated_at = ?
       WHERE candidate_id = ? AND question_index = ?`,
    )
    .run(sessionId, new Date().toISOString(), candidateId, questionIndex);
}

export function setAnswerSummary(
  candidateId: number,
  questionIndex: number,
  summary: string,
): void {
  getDb()
    .prepare(
      `UPDATE question_progress SET answer_summary = ?, updated_at = ?
       WHERE candidate_id = ? AND question_index = ?`,
    )
    .run(summary, new Date().toISOString(), candidateId, questionIndex);
}

// ── Integrity (soft proctoring) ─────────────────────────────────────────────────
// Batch-insert a client flush of integrity events for a session, in one transaction
// (mirrors the replaceUtterances pattern). `meta` is serialized to a JSON string.
export function insertIntegrityEvents(sessionId: number, events: IntegrityEventInput[]): void {
  if (!events.length) return;
  const conn = getDb();
  const now = new Date().toISOString();
  const ins = conn.prepare(
    `INSERT INTO integrity_events (session_id, type, meta, ts, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = conn.transaction((items: IntegrityEventInput[]) => {
    for (const e of items) {
      ins.run(sessionId, e.type, e.meta ? JSON.stringify(e.meta) : null, e.ts, now);
    }
  });
  tx(events);
}

export function getIntegrityEvents(sessionId: number): IntegrityEventRow[] {
  return getDb()
    .prepare(`SELECT * FROM integrity_events WHERE session_id = ? ORDER BY ts, id`)
    .all(sessionId) as IntegrityEventRow[];
}

// Derived at query time (no stored column) — same approach as the cost estimate on the
// review page. Returns the weighted risk score + band for a session's integrity events.
export function computeIntegritySummary(sessionId: number): IntegritySummary {
  const rows = getIntegrityEvents(sessionId);
  const parsed = rows.map((r) => ({
    type: r.type,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
  }));
  return summarizeIntegrity(parsed);
}

export interface SnapshotRow {
  id: number;
  session_id: number;
  path: string;
  ts: string;
  trigger: string | null; // null = periodic; otherwise the IntegrityType that triggered it
  created_at: string;
}

export function insertSnapshot(
  sessionId: number,
  path: string,
  ts: string,
  trigger: string | null = null,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO webcam_snapshots (session_id, path, ts, trigger, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, path, ts, trigger, now);
}

export function getSnapshots(sessionId: number): SnapshotRow[] {
  return getDb()
    .prepare(`SELECT * FROM webcam_snapshots WHERE session_id = ? ORDER BY ts`)
    .all(sessionId) as SnapshotRow[];
}

// ── Admin queries ──────────────────────────────────────────────────────────────

export interface CandidateListRow extends CandidateRow {
  session_count: number;
  completed_questions: number;
  total_questions: number;
  last_activity: string | null;
  providers_used: string | null; // GROUP_CONCAT of distinct providers
  total_heygen_min: number; // sum of completed HeyGen session durations
  total_tavus_min: number; // sum of completed Tavus session durations
}

export function getAllCandidates(): CandidateListRow[] {
  return getDb()
    .prepare(
      `SELECT
         c.id, c.display_name, c.resume_code, c.created_at,
         COUNT(DISTINCT s.id) AS session_count,
         SUM(CASE WHEN qp.status = 'completed' THEN 1 ELSE 0 END) AS completed_questions,
         COUNT(DISTINCT qp.id) AS total_questions,
         MAX(COALESCE(s.ended_at, s.started_at)) AS last_activity,
         GROUP_CONCAT(DISTINCT s.provider) AS providers_used,
         SUM(CASE WHEN s.provider = 'heygen' AND s.ended_at IS NOT NULL
               THEN (julianday(s.ended_at) - julianday(s.started_at)) * 1440.0
               ELSE 0 END) AS total_heygen_min,
         SUM(CASE WHEN s.provider = 'tavus' AND s.ended_at IS NOT NULL
               THEN (julianday(s.ended_at) - julianday(s.started_at)) * 1440.0
               ELSE 0 END) AS total_tavus_min
       FROM candidates c
       LEFT JOIN sessions s ON s.candidate_id = c.id
       LEFT JOIN question_progress qp ON qp.candidate_id = c.id
       GROUP BY c.id
       ORDER BY last_activity DESC, c.created_at DESC`,
    )
    .all() as CandidateListRow[];
}

// First question by index that is NOT completed (pending or timed-out both re-run) —
// this is the "retry on resume" landing point. null when every question is completed.
export function getNextQuestionIndex(candidateId: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(question_index) AS idx FROM question_progress
       WHERE candidate_id = ? AND status != 'completed'`,
    )
    .get(candidateId) as { idx: number | null };
  return row?.idx ?? null;
}

// ── Prompts (avatar-prompt catalog) ──────────────────────────────────────────────
// One row = one editable system prompt / interview script. Provider config blobs are
// stored as JSON strings; the CRUD layer accepts objects and serializes them on write.
export interface PromptRow {
  id: number;
  title: string;
  body: string;
  greeting: string | null;
  language: string;
  notes: string | null;
  heygen_config: string | null; // JSON string, see 0002_prompts.sql for the shape
  tavus_config: string | null; // JSON string, see 0002_prompts.sql for the shape
  created_at: string;
  updated_at: string;
}

export interface PromptInput {
  title: string;
  body: string;
  greeting?: string | null;
  language?: string;
  notes?: string | null;
  // Accept objects (serialized to JSON on write) or a pre-stringified/null value.
  heygenConfig?: Record<string, unknown> | string | null;
  tavusConfig?: Record<string, unknown> | string | null;
}

// Normalize a config input to the stored representation: null when absent, otherwise a
// JSON string (already-string values pass through so callers can store raw JSON).
function serializeConfig(value: Record<string, unknown> | string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function listPrompts(): PromptRow[] {
  return getDb().prepare(`SELECT * FROM prompts ORDER BY id`).all() as PromptRow[];
}

export function getPrompt(id: number): PromptRow | undefined {
  return getDb().prepare(`SELECT * FROM prompts WHERE id = ?`).get(id) as PromptRow | undefined;
}

export function countPrompts(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM prompts`).get() as { n: number };
  return row.n;
}

export function createPrompt(input: PromptInput): number {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO prompts
         (title, body, greeting, language, notes, heygen_config, tavus_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.body,
      input.greeting ?? null,
      input.language ?? 'it',
      input.notes ?? null,
      serializeConfig(input.heygenConfig),
      serializeConfig(input.tavusConfig),
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function updatePrompt(id: number, input: PromptInput): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE prompts
         SET title = ?, body = ?, greeting = ?, language = ?, notes = ?,
             heygen_config = ?, tavus_config = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.title,
      input.body,
      input.greeting ?? null,
      input.language ?? 'it',
      input.notes ?? null,
      serializeConfig(input.heygenConfig),
      serializeConfig(input.tavusConfig),
      now,
      id,
    );
}

export function deletePrompt(id: number): void {
  getDb().prepare(`DELETE FROM prompts WHERE id = ?`).run(id);
}

// ── Questions (managed interview-question catalog) ────────────────────────────────
// One row = one editable interview question. `enabled` is a 0/1 boolean; only disabled
// questions may be deleted (deleting one CASCADEs its template memberships away).
// evaluationCriteria is intentionally NOT stored — see 0003_questions_templates.sql.
export interface QuestionRow {
  id: number;
  name: string;
  text: string;
  objective: string | null;
  enabled: number; // 0/1 boolean
  created_at: string;
  updated_at: string;
}

export interface QuestionInput {
  name: string;
  text: string;
  objective?: string | null;
  enabled?: boolean;
}

export function listQuestions(): QuestionRow[] {
  return getDb().prepare(`SELECT * FROM questions ORDER BY id`).all() as QuestionRow[];
}

export function getQuestion(id: number): QuestionRow | undefined {
  return getDb().prepare(`SELECT * FROM questions WHERE id = ?`).get(id) as
    | QuestionRow
    | undefined;
}

export function countQuestions(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM questions`).get() as { n: number };
  return row.n;
}

export function createQuestion(input: QuestionInput): number {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO questions (name, text, objective, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.text,
      input.objective ?? null,
      input.enabled === false ? 0 : 1, // default enabled when omitted
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function updateQuestion(id: number, input: QuestionInput): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE questions
         SET name = ?, text = ?, objective = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.name,
      input.text,
      input.objective ?? null,
      input.enabled === false ? 0 : 1,
      now,
      id,
    );
}

export function setQuestionEnabled(id: number, enabled: boolean): void {
  getDb()
    .prepare(`UPDATE questions SET enabled = ?, updated_at = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
}

// Guard: enabled questions must be disabled before deletion, so an operator cannot
// silently drop a question that a template is actively running.
export function deleteQuestion(id: number): void {
  const row = getDb().prepare(`SELECT enabled FROM questions WHERE id = ?`).get(id) as
    | { enabled: number }
    | undefined;
  if (row?.enabled === 1) {
    throw new Error('Cannot delete an enabled question; disable it first.');
  }
  getDb().prepare(`DELETE FROM questions WHERE id = ?`).run(id);
}

// ── Templates (ordered question selections) ───────────────────────────────────────
export interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  enabled: number; // 0/1 boolean
  created_at: string;
  updated_at: string;
}

export interface TemplateInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
}

// Junction row between a template and a question, carrying the run order.
export interface TemplateQuestionRow {
  template_id: number;
  question_id: number;
  position: number;
}

export function listTemplates(): TemplateRow[] {
  return getDb().prepare(`SELECT * FROM templates ORDER BY id`).all() as TemplateRow[];
}

export function getTemplate(id: number): TemplateRow | undefined {
  return getDb().prepare(`SELECT * FROM templates WHERE id = ?`).get(id) as
    | TemplateRow
    | undefined;
}

export function countTemplates(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM templates`).get() as { n: number };
  return row.n;
}

export function createTemplate(input: TemplateInput): number {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `INSERT INTO templates (name, description, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.name, input.description ?? null, input.enabled === false ? 0 : 1, now, now);
  return Number(info.lastInsertRowid);
}

export function updateTemplate(id: number, input: TemplateInput): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE templates
         SET name = ?, description = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(input.name, input.description ?? null, input.enabled === false ? 0 : 1, now, id);
}

export function setTemplateEnabled(id: number, enabled: boolean): void {
  getDb()
    .prepare(`UPDATE templates SET enabled = ?, updated_at = ? WHERE id = ?`)
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
}

export function deleteTemplate(id: number): void {
  getDb().prepare(`DELETE FROM templates WHERE id = ?`).run(id);
}

// ── Template membership ───────────────────────────────────────────────────────────
// The template's questions, joined and returned in run order.
export function getTemplateQuestions(templateId: number): QuestionRow[] {
  return getDb()
    .prepare(
      `SELECT q.* FROM template_questions tq
         JOIN questions q ON q.id = tq.question_id
       WHERE tq.template_id = ?
       ORDER BY tq.position`,
    )
    .all(templateId) as QuestionRow[];
}

// Replace a template's membership atomically: wipe existing rows, then insert each id
// with position = its index in the provided ordered array.
export function setTemplateQuestions(templateId: number, orderedQuestionIds: number[]): void {
  const conn = getDb();
  const del = conn.prepare(`DELETE FROM template_questions WHERE template_id = ?`);
  const ins = conn.prepare(
    `INSERT INTO template_questions (template_id, question_id, position) VALUES (?, ?, ?)`,
  );
  const tx = conn.transaction((ids: number[]) => {
    del.run(templateId);
    ids.forEach((questionId, i) => ins.run(templateId, questionId, i));
  });
  tx(orderedQuestionIds);
}
