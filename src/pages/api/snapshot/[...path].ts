import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { snapshotFilePath } from '../../../lib/snapshots';

export const prerender = false;

export const GET: APIRoute = ({ params }) => {
  // snapshotFilePath validates + resolves the stored relative path (e.g. snapshots/12/x.jpg)
  // to a file under SNAPSHOTS_ROOT, guarding traversal and the legacy "snapshots/" prefix.
  const filePath = snapshotFilePath(params.path ?? '');
  if (!filePath) return new Response('Forbidden', { status: 403 });
  try {
    const data = readFileSync(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
};
