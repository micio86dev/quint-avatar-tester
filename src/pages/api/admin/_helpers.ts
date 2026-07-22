// Shared helpers for the additive admin CRUD API. Kept in a leading-underscore module
// so Astro does not treat it as a route (underscored files are ignored by file routing).

export function json(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Parse a JSON request body, returning null on any parse failure so callers can
// respond with a 400 instead of leaking an exception.
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

// Coerce a route [id] param to a positive integer, or null when it is not one.
export function parseId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// Parse a stored provider-config JSON string back into a structured value for GET
// responses. Returns null when absent or unparseable (never throws).
export function parseStoredConfig(value: string | null): unknown {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Read a provider-config field from a request body: accept an object (pass through)
// or null; reject other types (string/number/etc.) by returning `undefined` so the
// field is treated as "not provided". Objects and explicit null are honored.
export function readConfigInput(
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

// Wrap a handler so any unexpected throw becomes a 500 JSON response (no stack leak).
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    // Log the real error server-side; return a generic message so no exception
    // detail (stack, internal paths) leaks to the client.
    console.error('[admin api]', err);
    return json(500, { error: 'Internal server error' });
  }
}
