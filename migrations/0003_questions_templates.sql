-- Managed questions + templates model.
-- A question is one interview prompt row an operator can edit, enable/disable, and reuse.
-- A template is an ordered selection of questions that defines a runnable interview.
-- We intentionally do NOT store evaluationCriteria here: that is a scoring artifact and this
-- app only RUNS the interview, so the data would be unused. We keep `objective` because it
-- helps the avatar know when a question has been satisfactorily answered.

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  objective TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,   -- 0/1 boolean; only DISABLED questions may be deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ordered membership: which questions a template runs, and in what order.
CREATE TABLE template_questions (
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (template_id, question_id)
);
CREATE INDEX idx_template_questions_order ON template_questions(template_id, position);
