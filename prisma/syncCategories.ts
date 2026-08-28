import 'dotenv/config';
import { prisma } from '../src/config/database';
import { categoryDefinitions } from '../src/modules/categories/categories.config';
import { syncCategoriesFromConfig } from '../src/modules/categories/category.service';

/**
 * Applies src/modules/categories/categories.config.ts to the database.
 *
 * Unlike shelves:sync this never deletes: a category absent from the config is reported so
 * you can decide, because dropping one cascades through recipe_categories and would silently
 * unlabel every recipe using it.
 */
async function main() {
  const { created, updated, extra } = await syncCategoriesFromConfig(categoryDefinitions);

  console.log(`Categories synced: ${created} created, ${updated} updated.`);
  if (extra.length > 0) {
    console.warn(
      `\n${extra.length} category/categories exist in the database but not in the config: ` +
        `${extra.join(', ')}\n` +
        'Left untouched — deleting one removes it from every recipe that uses it. ' +
        'Remove it by hand if that is what you want.',
    );
  }
}

main()
  .catch((err) => {
    console.error('Category sync failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
