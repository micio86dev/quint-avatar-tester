// Unlock endpoint: checks the submitted password against APP_PASSWORD (constant-time) and,
// on success, sets the signed session cookie. Public (allowed by the middleware).
import type { APIRoute } from 'astro';
import { SESSION_COOKIE, sessionToken, verifyPassword } from '../../../lib/auth';

export const prerender = false;

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export const POST: APIRoute = async ({ request, cookies, url }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    /* invalid/missing body → treated as wrong password below */
  }
  const password =
    body && typeof (body as { password?: unknown }).password === 'string'
      ? (body as { password: string }).password
      : '';

  if (!verifyPassword(password)) {
    return new Response(JSON.stringify({ error: 'Wrong password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Behind Railway's proxy the internal protocol is http, so also honor the
  // forwarded header to keep the cookie Secure in production.
  const isHttps =
    url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';

  cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isHttps,
    maxAge: SESSION_MAX_AGE,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
