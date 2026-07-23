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
import { validateProviderConfig } from '../../../../lib/provider-config';
import { syncTavusPal } from '../../../../lib/tavus-pal';

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

    updateTemplate(id, input);
    if (typeof body.enabled === 'boolean') setTemplateEnabled(id, body.enabled);

    return json(200, { ...serializeTemplate(getTemplate(id)!), palWarning });
  });

export const DELETE: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getTemplate(id)) return json(404, { error: 'Template not found.' });
    deleteTemplate(id);
    return new Response(null, { status: 204 });
  });
