import type { APIRoute } from 'astro';
import {
  getTemplate,
  getTemplateQuestions,
  setTemplateQuestions,
} from '../../../../../lib/db';
import { guard, json, parseId, readJson } from '../../_helpers';

export const prerender = false;

export const GET: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getTemplate(id)) return json(404, { error: 'Template not found.' });
    return json(200, getTemplateQuestions(id));
  });

export const PUT: APIRoute = async ({ params, request }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    if (!getTemplate(id)) return json(404, { error: 'Template not found.' });

    const body = await readJson(request);
    if (!body) return json(400, { error: 'Invalid JSON body.' });

    const raw = body.questionIds;
    if (!Array.isArray(raw) || !raw.every((q) => Number.isInteger(q) && (q as number) > 0)) {
      return json(400, { error: 'Field "questionIds" must be an array of positive integers.' });
    }

    setTemplateQuestions(id, raw as number[]);
    return json(200, getTemplateQuestions(id));
  });
