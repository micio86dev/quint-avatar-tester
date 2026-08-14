import type { APIRoute } from 'astro';
import { listTemplates } from '../../../../lib/db';
import { guard, json, parseStoredConfig } from '../_helpers';
import { TEMPLATE_DOCUMENT_SCHEMA, toPortableConfig } from '../../../../lib/provider-config';

export const prerender = false;

/**
 * Export template configuration as a BEAI-importable document.
 *
 * The shape is BEAI's `beai.avatar-template/1`, deliberately: an export nobody
 * can import is a file, not a feature. A template here carries BOTH provider
 * blocks on one row, so it is emitted under `configs` — BEAI splits that into
 * one template per provider, because there a template belongs to exactly one
 * provider and that provider is immutable after creation.
 *
 * Only ENABLED templates are exported. A disabled template is one somebody
 * turned off; carrying it into another system would quietly resurrect it.
 *
 * Each config block is projected onto the portable key set (see
 * `toPortableConfig`) before it leaves: a producer must not emit fields outside
 * the schema it claims to speak, and `beai.avatar-template/1` does not define
 * every knob this project happens to store locally. The projection drops keys
 * from the document only — it never touches the stored row.
 *
 * KNOWN RESIDUAL RISK, values rather than keys: this project caps
 * `maxSessionDurationSec` at 3600 while BEAI caps HeyGen at 1200 (its real plan
 * ceiling). A local template above 1200 exports a key BEAI accepts carrying a
 * value it refuses as out of range. That is a genuine disagreement about what is
 * configurable, not a schema defect, and clamping it here would ship a template
 * that is not the one exported.
 */
export const GET: APIRoute = async () =>
  guard(async () => {
    const templates = listTemplates()
      .filter((row) => row.enabled === 1)
      .map((row) => {
        const configs: Record<string, unknown> = {};
        const heygen = toPortableConfig('heygen', parseStoredConfig(row.heygen_config));
        const tavus = toPortableConfig('tavus', parseStoredConfig(row.tavus_config));

        // Omitted rather than emitted as null: a null block would import as an
        // empty template for a provider nobody configured.
        if (heygen) configs.heygen = heygen;
        if (tavus) configs.tavus = tavus;

        return {
          name: row.name,
          description: row.description ?? null,
          configs,
        };
      });

    return json(200, {
      schema: TEMPLATE_DOCUMENT_SCHEMA,
      exported_at: new Date().toISOString(),
      source: 'quint-avatar-tester',
      templates,
    });
  });
