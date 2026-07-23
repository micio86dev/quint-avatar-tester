import type { APIRoute } from 'astro';
import { createTemplate, listTemplates, type TemplateInput } from '../../../../lib/db';
import { guard, json, parseStoredConfig, readConfigInput, readJson } from '../_helpers';
import { validateProviderConfig } from '../../../../lib/provider-config';
import { syncTavusPal } from '../../../../lib/tavus-pal';

export const prerender = false;

// Shape a stored template row for API responses: parse the config JSON strings back into
// structured objects (or null) so clients receive typed data, not raw JSON strings.
function serializeTemplate(row: ReturnType<typeof listTemplates>[number]) {
  const { heygen_config, tavus_config, ...rest } = row;
  return {
    ...rest,
    heygen_config: parseStoredConfig(heygen_config),
    tavus_config: parseStoredConfig(tavus_config),
  };
}

export const GET: APIRoute = async () =>
  guard(async () => json(200, listTemplates().map(serializeTemplate)));

export const POST: APIRoute = async ({ request }) =>
  guard(async () => {
    const body = await readJson(request);
    if (!body) return json(400, { error: 'Invalid JSON body.' });

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return json(400, { error: 'Field "name" is required.' });
    }

    const heygenConfig = readConfigInput(body.heygenConfig);
    const tavusConfig = readConfigInput(body.tavusConfig);

    // Reject hard config errors (type/range/enum). Missing recommended IDs are allowed —
    // they fall back to .env at runtime.
    const hardErrors = [
      ...validateProviderConfig('heygen', heygenConfig ?? null),
      ...validateProviderConfig('tavus', tavusConfig ?? null),
    ].filter((e) => e.code !== 'required');
    if (hardErrors.length) {
      return json(400, { error: 'Invalid provider config.', errors: hardErrors });
    }

    // Manage the Tavus PAL so persona-level knobs take effect; on create, store the new
    // palId into the config before persisting. PAL failures degrade to a warning.
    let palWarning: string | undefined;
    if (tavusConfig) {
      const pal = await syncTavusPal(tavusConfig);
      if (pal.status === 'created') tavusConfig.palId = pal.palId;
      else if (pal.status === 'warning') palWarning = pal.message;
    }

    const input: TemplateInput = {
      name,
      description: typeof body.description === 'string' ? body.description : null,
      heygenConfig,
      tavusConfig,
    };
    if (typeof body.enabled === 'boolean') input.enabled = body.enabled;

    const id = createTemplate(input);
    return json(201, { id, palWarning });
  });
