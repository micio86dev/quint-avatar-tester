import type { APIRoute } from 'astro';
import { createPrompt, listPrompts, type PromptInput } from '../../../../lib/db';
import { guard, json, readJson } from '../_helpers';

export const prerender = false;

export const GET: APIRoute = async () => guard(async () => json(200, listPrompts()));

export const POST: APIRoute = async ({ request }) =>
  guard(async () => {
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

    const id = createPrompt(input);
    return json(201, { id });
  });
