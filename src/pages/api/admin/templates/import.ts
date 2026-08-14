import type { APIRoute } from 'astro';
import { createTemplate, listTemplates, type TemplateInput } from '../../../../lib/db';
import { guard, json } from '../_helpers';
import {
  PROVIDERS,
  TEMPLATE_DOCUMENT_SCHEMA,
  isProvider,
  validateProviderConfig,
  type ConfigError,
  type Provider,
} from '../../../../lib/provider-config';

export const prerender = false;

/**
 * Import a `beai.avatar-template/1` document.
 *
 * The mirror image of ./export.ts, and deliberately symmetric with BEAI's
 * importer so a file moves in either direction: this project exports `configs`
 * (both providers on one row), BEAI exports `provider` + `config` (one provider
 * per row, because there the provider is immutable after creation). Both shapes
 * are accepted here — a document that only one of the two can read is not
 * portability, it is a one-way door.
 *
 * This endpoint eats a file a human picked off their disk, so every assumption
 * is checked: size, JSON validity, envelope version, entry shape, per-provider
 * config. Nothing here may 500, and nothing may be written without appearing in
 * the report.
 */

/** Refuse oversized uploads before they are buffered. A template document is small. */
const MAX_BODY_BYTES = 1_000_000;

/** A sane ceiling on entries; well past any real export, short of a denial of service. */
const MAX_ENTRIES = 500;

type ReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'too_large' };

/**
 * Read the body as text without trusting Content-Length.
 *
 * The declared length is checked first (cheap rejection), but the stream is also
 * capped while it is consumed: a client that lies about, or omits, the header
 * must not be able to make the server buffer an unbounded string.
 */
async function readBoundedText(request: Request, maxBytes: number): Promise<ReadResult> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };

  const body = request.body;
  if (!body) return { ok: false, reason: 'empty' };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return { ok: false, reason: 'empty' };

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(merged) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One document entry, resolved to the single row this project stores. */
interface ImportRecord {
  name: string;
  description: string | null;
  configs: Partial<Record<Provider, Record<string, unknown>>>;
}

type FlattenOutcome = { ok: true; record: ImportRecord } | { ok: false; error: string };

/**
 * Resolve an entry to one template row, accepting both document shapes.
 *
 * BEAI's `flatten()` SPLITS a multi-provider entry into one template per
 * provider, because a BEAI template belongs to exactly one provider. Here the
 * mapping runs the other way: a row holds both blocks, so a multi-provider entry
 * collapses into one row and a single-provider entry becomes a row with only
 * that block filled. Same two input shapes, opposite fan-out — splitting here
 * would turn one template into two on every round trip.
 *
 * A BEAI entry may also carry `persona`, which has no column in this project.
 * It is ignored rather than refused: rejecting a document over a field this side
 * simply does not model would block the transfer it exists to enable.
 */
function flattenEntry(entry: unknown): FlattenOutcome {
  if (!isPlainObject(entry)) {
    return { ok: false, error: 'Entry must be an object.' };
  }

  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (!name) return { ok: false, error: 'A template needs a name.' };

  const description = typeof entry.description === 'string' ? entry.description : null;
  const configs: Partial<Record<Provider, Record<string, unknown>>> = {};

  // Single-provider shape: BEAI's own export.
  if (entry.provider !== undefined && entry.provider !== null) {
    if (!isProvider(entry.provider)) {
      return { ok: false, error: `Unknown provider "${String(entry.provider)}".` };
    }
    const config = entry.config === undefined || entry.config === null ? {} : entry.config;
    if (!isPlainObject(config)) {
      return { ok: false, error: `Config for provider "${entry.provider}" must be an object.` };
    }
    configs[entry.provider] = config;
    return { ok: true, record: { name, description, configs } };
  }

  // Multi-provider shape: this project's own export.
  if (!isPlainObject(entry.configs)) {
    return { ok: false, error: 'Entry has no provider configuration ("configs" or "provider").' };
  }

  for (const [provider, config] of Object.entries(entry.configs)) {
    if (!isProvider(provider)) {
      return { ok: false, error: `Unknown provider "${provider}".` };
    }
    if (!isPlainObject(config)) {
      return { ok: false, error: `Config for provider "${provider}" must be an object.` };
    }
    configs[provider] = config;
  }

  if (Object.keys(configs).length === 0) {
    return { ok: false, error: 'Entry has no provider configuration ("configs" is empty).' };
  }

  return { ok: true, record: { name, description, configs } };
}

/**
 * Validate a record's provider blocks with the SAME validator the create/edit form is
 * built from. A second validator would drift, and the divergence would let a file
 * install a config the form would have refused.
 *
 * `required` is ignored exactly as the CRUD routes ignore it: a missing recommended ID
 * falls back to .env at runtime, so it must not block a transfer.
 */
function hardErrorsFor(record: ImportRecord): Array<ConfigError & { provider: Provider }> {
  const out: Array<ConfigError & { provider: Provider }> = [];
  for (const provider of PROVIDERS) {
    const config = record.configs[provider];
    if (!config) continue;
    for (const error of validateProviderConfig(provider, config)) {
      if (error.code !== 'required') out.push({ ...error, provider });
    }
  }
  return out;
}

/**
 * Never overwrite: a colliding name gets a numeric suffix.
 *
 * Overwriting would silently replace the configuration somebody is running
 * experiments on, with nothing shown of what was lost. Creating is recoverable —
 * the operator can delete a duplicate; they cannot undelete a template.
 *
 * `taken` also accumulates names created earlier in this same request, so two
 * identically-named entries in one document do not both land on the same name.
 */
function uniqueName(taken: Set<string>, name: string): string {
  let candidate = name;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${name} (${suffix})`;
    suffix += 1;
  }
  return candidate;
}

type EntryResult =
  | {
      index: number;
      status: 'created';
      id: number;
      requestedName: string;
      name: string;
      renamed: boolean;
      providers: Provider[];
    }
  | {
      index: number;
      status: 'rejected';
      requestedName: string | null;
      error: string;
      errors?: Array<ConfigError & { provider: Provider }>;
    };

export const POST: APIRoute = async ({ request }) =>
  guard(async () => {
    const body = await readBoundedText(request, MAX_BODY_BYTES);
    if (!body.ok) {
      return body.reason === 'too_large'
        ? json(413, {
            error: `Document too large. The limit is ${MAX_BODY_BYTES} bytes.`,
          })
        : json(400, { error: 'Empty request body. Upload a template document.' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return json(400, { error: 'The file is not valid JSON.' });
    }

    if (!isPlainObject(parsed)) {
      return json(400, { error: 'The document must be a JSON object.' });
    }

    if (parsed.schema !== TEMPLATE_DOCUMENT_SCHEMA) {
      return json(422, {
        error:
          `Unsupported document version ${JSON.stringify(parsed.schema ?? null)}. ` +
          `Expected "${TEMPLATE_DOCUMENT_SCHEMA}".`,
      });
    }

    if (!Array.isArray(parsed.templates)) {
      return json(422, { error: 'Field "templates" must be an array.' });
    }

    if (parsed.templates.length === 0) {
      return json(422, { error: 'The document contains no templates.' });
    }

    if (parsed.templates.length > MAX_ENTRIES) {
      return json(422, {
        error: `The document contains too many templates (limit ${MAX_ENTRIES}).`,
      });
    }

    // Snapshot the existing names once: there is no unique index on templates.name, so
    // collision avoidance lives here rather than in the database.
    const taken = new Set(listTemplates().map((row) => row.name));
    const results: EntryResult[] = [];

    parsed.templates.forEach((entry, index) => {
      const flattened = flattenEntry(entry);
      if (!flattened.ok) {
        const requestedName =
          isPlainObject(entry) && typeof entry.name === 'string' ? entry.name : null;
        results.push({ index, status: 'rejected', requestedName, error: flattened.error });
        return;
      }

      const record = flattened.record;
      const errors = hardErrorsFor(record);
      if (errors.length) {
        results.push({
          index,
          status: 'rejected',
          requestedName: record.name,
          error: 'Invalid provider config.',
          errors,
        });
        return;
      }

      const name = uniqueName(taken, record.name);
      taken.add(name);

      // Persist DIRECTLY — no syncTavusPal(), unlike the create/update routes.
      // That call creates or patches a REAL Tavus persona over the network and
      // rewrites config.palId with the newly minted id. An import is a data
      // transfer, not a provisioning action: provisioning here would mint
      // personas nobody asked for and overwrite exactly the ids the operator is
      // trying to move. Editing and saving the template applies the PAL sync,
      // deliberately, once a human has looked at it.
      const input: TemplateInput = {
        name,
        description: record.description,
        // Imports arrive DISABLED. A file must never change what a live interview
        // runs on before somebody has reviewed it.
        enabled: false,
        heygenConfig: record.configs.heygen ?? null,
        tavusConfig: record.configs.tavus ?? null,
      };

      results.push({
        index,
        status: 'created',
        id: createTemplate(input),
        requestedName: record.name,
        name,
        renamed: name !== record.name,
        providers: PROVIDERS.filter((p) => record.configs[p] !== undefined),
      });
    });

    const created = results.filter((r) => r.status === 'created').length;
    const rejected = results.length - created;

    // 201 when anything landed, 422 when nothing did. Either way the per-entry report is
    // the payload: a partial import that does not say which entries failed is worse than
    // a refusal, because the operator believes a configuration is present when it is not.
    return json(created > 0 ? 201 : 422, { created, rejected, results });
  });
