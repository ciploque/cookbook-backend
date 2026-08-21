import 'dotenv/config';
import { prisma } from '../src/config/database';
import { refreshAllShelves } from '../src/modules/shelves/shelf.service';

/**
 * Re-resolves shelf criteria and rewrites the snapshots that GET /shelves serves.
 *
 * Run for all shelves, or one: `npm run shelves:refresh -- top-drinks`.
 * Intended to be called on a schedule (host cron / platform scheduler); every 15 minutes is
 * ample — the most time-sensitive shelf is "Recently Added".
 */
async function main() {
  const slug = process.argv[2];

  const results = await refreshAllShelves(slug);
  if (results.length === 0) {
    console.log('No shelves found — run `npm run shelves:sync` first.');
    return;
  }

  for (const result of results) {
    if (result.error) console.error(`✗ ${result.slug}: ${result.error}`);
    else console.log(`✓ ${result.slug}: ${result.count} recipe(s)`);
  }

  const failed = results.filter((r) => r.error).length;
  if (failed > 0) {
    console.error(`\n${failed} of ${results.length} shelf/shelves failed.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Shelf refresh failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
