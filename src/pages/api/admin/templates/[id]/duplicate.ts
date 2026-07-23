import type { APIRoute } from 'astro';
import { duplicateTemplate } from '../../../../../lib/db';
import { guard, json, parseId } from '../../_helpers';

export const prerender = false;

// Duplicate a template (meta + provider config + ordered questions); returns the new id.
export const POST: APIRoute = async ({ params }) =>
  guard(async () => {
    const id = parseId(params.id);
    if (id === null) return json(400, { error: 'Invalid id.' });
    const newId = duplicateTemplate(id);
    if (newId === null) return json(404, { error: 'Template not found.' });
    return json(201, { id: newId });
  });
