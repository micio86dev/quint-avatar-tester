// Standalone seeder: runs migrations (via openDb) then seeds the prompt, questions,
// and default template. Run with: npm run db:seed
import { getDbPath } from '../lib/db';
import { seed } from '../lib/seed';

function main(): void {
  const result = seed(); // seed() opens the app DB, which runs migrations first
  console.log(
    `Seed complete at ${getDbPath()}: ${result.promptsInserted} prompt(s), ` +
      `${result.questionsInserted} question(s), ${result.templatesInserted} template(s).`,
  );
}

main();
