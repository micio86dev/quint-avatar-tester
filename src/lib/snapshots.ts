// Server-only: where webcam proctoring snapshots live on disk, and how a stored relative
// path maps back to a file. Centralized so the write route and the serve route can never
// drift apart — they used to duplicate this and disagreed on the root, so serving 404'd.
import { dirname, resolve } from 'node:path';

// Snapshots MUST sit on the same persistent volume as the SQLite DB, or every redeploy on
// Railway wipes the image files while the DB rows survive (→ 404s). So the root defaults to
// the DB directory's /snapshots: setting DATABASE_PATH (e.g. /data/interviews.db) alone puts
// snapshots at /data/snapshots on the volume. SNAPSHOTS_PATH still overrides explicitly.
function resolveRoot(): string {
  if (process.env.SNAPSHOTS_PATH) return resolve(process.env.SNAPSHOTS_PATH);
  if (process.env.DATABASE_PATH) return resolve(dirname(resolve(process.env.DATABASE_PATH)), 'snapshots');
  return resolve(process.cwd(), 'data', 'snapshots');
}

export const SNAPSHOTS_ROOT = resolveRoot();

// Relative path stored in the DB for a snapshot. Kept in this shape because existing rows
// use it; the serve side strips the leading "snapshots/" segment when resolving to disk.
export function snapshotRelPath(sessionId: number, fileName: string): string {
  return `snapshots/${sessionId}/${fileName}`;
}

// Absolute on-disk file for a stored relative path. Strips the leading "snapshots/" prefix so
// it resolves against SNAPSHOTS_ROOT exactly once (the old serve route double-nested it), and
// guards against path traversal. Returns null when the path is malformed or escapes the root.
export function snapshotFilePath(relPath: string): string | null {
  const stripped = relPath.replace(/^snapshots\//, '');
  if (!stripped || stripped.includes('..') || !/^[\w\-./]+$/.test(stripped)) return null;
  const file = resolve(SNAPSHOTS_ROOT, stripped);
  return file.startsWith(SNAPSHOTS_ROOT + '/') ? file : null;
}
