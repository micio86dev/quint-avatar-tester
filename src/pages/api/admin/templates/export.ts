import type { APIRoute } from 'astro';
import { listTemplates } from '../../../../lib/db';
import { guard, json, parseStoredConfig } from '../_helpers';

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
 * KNOWN INCOMPATIBILITY: this project's HeyGen config may carry
 * `voiceProvider`, which BEAI's field specs do not define. BEAI refuses unknown
 * keys rather than dropping them — by design, so an import cannot silently
 * produce a template that is not the one exported. If that key matters, it has
 * to be added to BEAI's ProviderFieldSpecs; it is not stripped here, because an
 * exporter that quietly edits its own data is worse than one that is refused.
 */
export const GET: APIRoute = async () =>
  guard(async () => {
    const templates = listTemplates()
      .filter((row) => row.enabled === 1)
      .map((row) => {
        const configs: Record<string, unknown> = {};
        const heygen = parseStoredConfig(row.heygen_config);
        const tavus = parseStoredConfig(row.tavus_config);

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
      schema: 'beai.avatar-template/1',
      exported_at: new Date().toISOString(),
      source: 'quint-avatar-tester',
      templates,
    });
  });
