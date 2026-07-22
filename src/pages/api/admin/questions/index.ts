import type { APIRoute } from 'astro';
import { createQuestion, listQuestions, type QuestionInput } from '../../../../lib/db';
import { guard, json, readJson } from '../_helpers';

export const prerender = false;

export const GET: APIRoute = async () => guard(async () => json(200, listQuestions()));

export const POST: APIRoute = async ({ request }) =>
  guard(async () => {
    const body = await readJson(request);
    if (!body) return json(400, { error: 'Invalid JSON body.' });

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const text = typeof body.text === 'string' ? body.text : '';
    if (!name || !text) {
      return json(400, { error: 'Fields "name" and "text" are required.' });
    }

    const input: QuestionInput = {
      name,
      text,
      objective: typeof body.objective === 'string' ? body.objective : null,
    };
    if (typeof body.enabled === 'boolean') input.enabled = body.enabled;

    const id = createQuestion(input);
    return json(201, { id });
  });
