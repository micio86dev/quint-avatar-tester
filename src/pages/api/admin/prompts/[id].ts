import type { APIRoute } from 'astro';
import { deletePrompt, getPrompt, updatePrompt, type PromptInput } from '../../../../lib/db';
import { guard, json, parseId, readJson } from '../_helpers';

export const prerender = false;

export const GET: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    const row = getPrompt(id);
    if (!row) return json(404, { error: 'Prompt not found.' });
    return json(200, row);
  });

export const PUT: APIRoute = async ({ params, request }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getPrompt(id)) return json(404, { error: 'Prompt not found.' });

    const body = await readJson(request);
    if (!body) return json(400, { error: 'Invalid JSON body.' });

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const text = typeof body.body === 'string' ? body.body : '';
    if (!title || !text) {
      return json(400, { error: 'Fields "title" and "body" are required.' });
    }

    const input: PromptInput = {
      title,
      body: text,
      greeting: typeof body.greeting === 'string' ? body.greeting : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    };
    if (typeof body.language === 'string' && body.language) input.language = body.language;

    updatePrompt(id, input);
    const row = getPrompt(id)!;
    return json(200, row);
  });

export const DELETE: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getPrompt(id)) return json(404, { error: 'Prompt not found.' });
    deletePrompt(id);
    return new Response(null, { status: 204 });
  });
