import type { APIRoute } from 'astro';
import {
  deleteTemplate,
  getTemplate,
  setTemplateEnabled,
  updateTemplate,
  type TemplateInput,
} from '../../../../lib/db';
import {
  guard,
  json,
  parseId,
  parseStoredConfig,
  readConfigInput,
  readJson,
} from '../_helpers';

export const prerender = false;

function serializeTemplate(row: NonNullable<ReturnType<typeof getTemplate>>) {
  const { heygen_config, tavus_config, ...rest } = row;
  return {
    ...rest,
    heygen_config: parseStoredConfig(heygen_config),
    tavus_config: parseStoredConfig(tavus_config),
  };
}

export const GET: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    const row = getTemplate(id);
    if (!row) return json(404, { error: 'Template not found.' });
    return json(200, serializeTemplate(row));
  });

export const PUT: APIRoute = async ({ params, request }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getTemplate(id)) return json(404, { error: 'Template not found.' });

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

    updateTemplate(id, input);
    if (typeof body.enabled === 'boolean') setTemplateEnabled(id, body.enabled);

    return json(200, serializeTemplate(getTemplate(id)!));
  });

export const DELETE: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getTemplate(id)) return json(404, { error: 'Template not found.' });
    deleteTemplate(id);
    return new Response(null, { status: 204 });
  });
