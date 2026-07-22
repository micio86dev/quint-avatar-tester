// Standalone migration runner: opens the app DB and applies pending migrations.
// Run with: npm run db:migrate
import { getDbPath, openDb } from '../lib/db';

function main(): void {
  const conn = openDb(); // openDb runs migrations as part of opening the connection
  const applied = (
    conn.prepare(`SELECT COUNT(*) AS n FROM _migrations`).get() as { n: number }
  ).n;
  conn.close();
  console.log(`Migrations up to date at ${getDbPath()} (${applied} recorded).`);
}

main();
