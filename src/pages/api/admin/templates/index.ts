import type { APIRoute } from 'astro';
import { createTemplate, listTemplates, type TemplateInput } from '../../../../lib/db';
import { guard, json, parseStoredConfig, readConfigInput, readJson } from '../_helpers';

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

    const input: TemplateInput = {
      name,
      description: typeof body.description === 'string' ? body.description : null,
      heygenConfig: readConfigInput(body.heygenConfig),
      tavusConfig: readConfigInput(body.tavusConfig),
    };
    if (typeof body.enabled === 'boolean') input.enabled = body.enabled;

    const id = createTemplate(input);
    return json(201, { id });
  });
