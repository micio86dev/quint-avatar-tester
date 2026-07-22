-- Baseline schema for the interview persistence layer.
-- This is the exact schema previously created inline in src/lib/db.ts (getDb), with the
-- former ensureColumn() ALTERs folded into the CREATE TABLE column lists so a fresh DB
-- gets the final shape directly. The runner guards application via _migrations, so plain
-- CREATE TABLE (no IF NOT EXISTS) is used here.

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_session_id TEXT,
  questions_version TEXT,
  candidate_id INTEGER,
  question_id TEXT,
  question_index INTEGER,
  ended_reason TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  timezone TEXT,
  provider_meta TEXT
);

CREATE TABLE utterances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  seq INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_utterances_session ON utterances(session_id);

CREATE TABLE candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT,
  resume_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE question_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  question_id TEXT,
  question_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','timeout','skipped')),
  session_id INTEGER,
  answer_summary TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_progress_candidate ON question_progress(candidate_id);

CREATE TABLE integrity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  meta TEXT,
  ts TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_integrity_session ON integrity_events(session_id);

CREATE TABLE webcam_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  ts TEXT NOT NULL,
  trigger TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_snapshots_session ON webcam_snapshots(session_id);
