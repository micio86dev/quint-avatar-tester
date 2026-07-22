-- Provider config blocks move from prompts to templates: the template is the full
-- experiment recipe (ordered questions + provider config); the prompt is persona-only.
ALTER TABLE templates ADD COLUMN heygen_config TEXT;
ALTER TABLE templates ADD COLUMN tavus_config TEXT;
ALTER TABLE prompts DROP COLUMN heygen_config;
ALTER TABLE prompts DROP COLUMN tavus_config;
