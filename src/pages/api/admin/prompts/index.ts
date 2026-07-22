import type { APIRoute } from 'astro';
import { createPrompt, listPrompts, type PromptInput } from '../../../../lib/db';
import { guard, json, parseStoredConfig, readConfigInput, readJson } from '../_helpers';

export const prerender = false;

// Shape a stored prompt row for API responses: parse the config JSON strings back into
// structured objects (or null) so clients receive typed data, not raw JSON strings.
function serializePrompt(row: ReturnType<typeof listPrompts>[number]) {
  const { heygen_config, tavus_config, ...rest } = row;
  return {
    ...rest,
    heygen_config: parseStoredConfig(heygen_config),
    tavus_config: parseStoredConfig(tavus_config),
  };
}

export const GET: APIRoute = async () =>
  guard(async () => json(200, listPrompts().map(serializePrompt)));

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
      heygenConfig: readConfigInput(body.heygenConfig),
      tavusConfig: readConfigInput(body.tavusConfig),
    };
    if (typeof body.language === 'string' && body.language) input.language = body.language;

    const id = createPrompt(input);
    return json(201, { id });
  });
