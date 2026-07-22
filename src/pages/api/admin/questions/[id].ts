import type { APIRoute } from 'astro';
import {
  deleteQuestion,
  getQuestion,
  setQuestionEnabled,
  updateQuestion,
  type QuestionInput,
} from '../../../../lib/db';
import { guard, json, parseId, readJson } from '../_helpers';

export const prerender = false;

export const GET: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    const row = getQuestion(id);
    if (!row) return json(404, { error: 'Question not found.' });
    return json(200, row);
  });

export const PUT: APIRoute = async ({ params, request }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getQuestion(id)) return json(404, { error: 'Question not found.' });

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

    updateQuestion(id, input);
    // Apply the enable/disable flag explicitly too, so the boolean is honored even if a
    // future updateQuestion signature diverges on default handling.
    if (typeof body.enabled === 'boolean') setQuestionEnabled(id, body.enabled);

    return json(200, getQuestion(id)!);
  });

export const DELETE: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getQuestion(id)) return json(404, { error: 'Question not found.' });
    try {
      deleteQuestion(id);
    } catch (err) {
      // The enabled-question guard throws; surface it as a 409 conflict.
      return json(409, { error: err instanceof Error ? err.message : String(err) });
    }
    return new Response(null, { status: 204 });
  });
