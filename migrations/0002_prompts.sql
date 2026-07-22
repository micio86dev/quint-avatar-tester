-- Avatar-prompt catalog: each row is one system prompt / interview script that an
-- operator can edit and run as an experiment. `body` is the experiment variable.
-- Provider-specific tuning is stored as opaque JSON blobs (nullable) so the schema
-- does not couple to any single provider's option surface.

CREATE TABLE prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,            -- full system prompt / interview script (the experiment variable)
  greeting TEXT,                 -- opening line, spoken verbatim
  language TEXT NOT NULL DEFAULT 'it',
  notes TEXT,
  heygen_config TEXT,            -- JSON block, provider-specific (nullable)
  tavus_config TEXT,             -- JSON block, provider-specific (nullable)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Intended JSON shapes for the provider config blobs (documented here, not enforced):
--   heygen_config: { avatar_id, voice_id, voice_speed, video_quality,
--                    max_session_duration, interactivity_type }
--   tavus_config:  { replica_id, persona_id, llm_model, temperature,
--                    external_voice_id, turn_taking_patience, max_call_duration,
--                    enable_recording }
