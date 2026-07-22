// Access gate: every page and API route requires an unlocked session cookie, except the
// unlock page/endpoints and static assets. Unauthenticated page requests are redirected
// to /unlock; unauthenticated API requests get a 401 JSON response.
import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, isValidSession } from './lib/auth';

const PUBLIC_PAGES = new Set(['/unlock']);
const PUBLIC_API = new Set(['/api/auth/unlock', '/api/auth/logout']);

// Anything the unlock page itself needs must load without a session, plus any real file
// (has an extension): Astro build output (/_astro), the image endpoint, proctor assets.
function isAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_astro') ||
    pathname.startsWith('/_image') ||
    pathname.startsWith('/proctor') ||
    pathname === '/favicon.ico' ||
    /\.[^/]+$/.test(pathname)
  );
}

export const onRequest = defineMiddleware((context, next) => {
  const { pathname } = context.url;

  if (isAsset(pathname) || PUBLIC_PAGES.has(pathname) || PUBLIC_API.has(pathname)) {
    return next();
  }

  const token = context.cookies.get(SESSION_COOKIE)?.value;
  if (isValidSession(token)) return next();

  if (pathname.startsWith('/api')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const next_ = encodeURIComponent(pathname + context.url.search);
  return context.redirect(`/unlock?next=${next_}`);
});
