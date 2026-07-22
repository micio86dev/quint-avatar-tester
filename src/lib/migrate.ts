// Versioned SQLite migration runner. Replaces the old "create schema on boot" logic:
// each *.sql file under migrations/ is applied exactly once, in filename order, and
// recorded in _migrations. Re-running is a no-op — the runner guards on the ledger.
// Kept dependency-free (node:fs / node:path only) so it can run under tsx scripts too.
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Apply every not-yet-recorded migration inside a transaction and record its filename.
// Idempotent: already-applied files are skipped. Files are sorted ascending by name,
// so the numeric prefix (0001_, 0002_, …) drives ordering.
export function runMigrations(conn: Database.Database, migrationsDir?: string): void {
  const dir = migrationsDir ?? resolve(process.cwd(), 'migrations');

  conn.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (conn.prepare(`SELECT name FROM _migrations`).all() as { name: string }[]).map((r) => r.name),
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const record = conn.prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, ?)`);

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(dir, file), 'utf8');
    // Each migration is atomic: schema change + ledger insert commit together, so a
    // failure leaves neither half applied.
    const tx = conn.transaction(() => {
      conn.exec(sql);
      record.run(file, new Date().toISOString());
    });
    tx();
  }
}
