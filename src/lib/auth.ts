// Minimal shared-password access gate.
// One password (APP_PASSWORD) unlocks the whole app; a signed, httpOnly cookie carries
// the unlocked state. The cookie value is an HMAC — the raw password is never stored
// client-side, and the cookie cannot be forged without the signing secret.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_PASSWORD, APP_SESSION_SECRET } from 'astro:env/server';

export const SESSION_COOKIE = 'qat_session';

// Effective password. astro:env does not apply `default` to secret vars, so the fallback
// lives here: the gate works out of the box, and APP_PASSWORD in .env overrides it.
const DEFAULT_PASSWORD = '12345Abc$';
function appPassword(): string {
  return APP_PASSWORD || DEFAULT_PASSWORD;
}

// Session cookies are signed with APP_SESSION_SECRET; when it is empty we fall back to
// the password itself, so rotating APP_PASSWORD also invalidates every existing session.
function signingSecret(): string {
  return APP_SESSION_SECRET || appPassword();
}

// Length-independent constant-time comparison (timingSafeEqual throws on length mismatch).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyPassword(input: string): boolean {
  if (!input) return false;
  return safeEqual(input, appPassword());
}

// The value we store in the session cookie: HMAC-SHA256(secret, "unlocked").
export function sessionToken(): string {
  return createHmac('sha256', signingSecret()).update('unlocked').digest('hex');
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  return safeEqual(token, sessionToken());
}
