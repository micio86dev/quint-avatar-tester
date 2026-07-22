import type { APIRoute } from 'astro';
import { createTemplate, listTemplates, type TemplateInput } from '../../../../lib/db';
import { guard, json, readJson } from '../_helpers';

export const prerender = false;

export const GET: APIRoute = async () => guard(async () => json(200, listTemplates()));

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
    };
    if (typeof body.enabled === 'boolean') input.enabled = body.enabled;

    const id = createTemplate(input);
    return json(201, { id });
  });
