import 'dotenv/config';
import { prisma } from '../src/config/database';
import { shelfDefinitions } from '../src/modules/shelves/shelves.config';
import { refreshAllShelves, syncShelvesFromConfig } from '../src/modules/shelves/shelf.service';

/**
 * Applies src/modules/shelves/shelves.config.ts to the database, then refreshes contents.
 * One command takes a config edit all the way to what the landing page serves.
 */
async function main() {
  const { created, updated, deleted } = await syncShelvesFromConfig(shelfDefinitions);

  console.log(`Shelves synced: ${created} created, ${updated} updated.`);
  if (deleted.length > 0) {
    console.log(`Removed ${deleted.length} shelf/shelves absent from config: ${deleted.join(', ')}`);
  }

  console.log('\nRefreshing contents…');
  const results = await refreshAllShelves();
  for (const result of results) {
    if (result.error) console.error(`  ✗ ${result.slug}: ${result.error}`);
    else console.log(`  ✓ ${result.slug}: ${result.count} recipe(s)`);
  }

  const failed = results.filter((r) => r.error).length;
  if (failed > 0) {
    console.error(`\n${failed} shelf/shelves failed to refresh.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Shelf sync failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
