-- Single continuous avatar session driven by prompt × template.
-- The per-candidate / per-question interview flow is removed: a session now references
-- the prompt (persona) and the template (ordered questions + provider config) it ran,
-- instead of a candidate + one question. The candidate and question_progress tables and
-- their session columns are dropped along with the flow.
-- (better-sqlite3 ^12 supports SQLite DROP COLUMN.)

ALTER TABLE sessions ADD COLUMN prompt_id INTEGER;
ALTER TABLE sessions ADD COLUMN template_id INTEGER;

ALTER TABLE sessions DROP COLUMN candidate_id;
ALTER TABLE sessions DROP COLUMN question_id;
ALTER TABLE sessions DROP COLUMN question_index;
ALTER TABLE sessions DROP COLUMN questions_version;

DROP INDEX IF EXISTS idx_progress_candidate;
DROP TABLE IF EXISTS question_progress;
DROP TABLE IF EXISTS candidates;
