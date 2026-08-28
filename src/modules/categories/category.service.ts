import { Category } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { CategoryDefinition, categoryDefinitionSchema } from './category.schema';

// ── Serving ──────────────────────────────────────────────────────────────────

// Deliberately unpaginated: the registry is curated and small (tens of rows, not thousands),
// and the caller is a category nav that wants the whole list in one request. Zero-count
// categories are included — a curated category with no recipes yet is still a real nav entry.
export async function listCategories() {
  const categories = await prisma.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { recipeCategories: true } },
    },
    orderBy: { name: 'asc' },
  });

  return categories.map(({ _count, ...category }) => ({
    ...category,
    recipeCount: _count.recipeCategories,
  }));
}

// ── Write-path helper ────────────────────────────────────────────────────────

/**
 * Resolves category slugs to rows for a recipe write — the counterpart of upsertTags, except
 * this one never creates: categories are curated, so an unknown slug is caller error.
 *
 * Call it *before* opening the recipe transaction, so a bad slug 422s without a partial write.
 */
export async function resolveCategories(slugs: string[]): Promise<Category[]> {
  if (slugs.length === 0) return [];

  const uniqueSlugs = [...new Set(slugs)];
  const categories = await prisma.category.findMany({ where: { slug: { in: uniqueSlugs } } });

  if (categories.length !== uniqueSlugs.length) {
    const found = new Set(categories.map((c) => c.slug));
    const unknown = uniqueSlugs.filter((slug) => !found.has(slug));
    throw ApiError.validation({
      categories: unknown.map((slug) => `Unknown category: ${slug}`),
    });
  }

  return categories;
}

// ── Config sync (CLI-driven) ─────────────────────────────────────────────────

export interface CategorySyncResult {
  created: number;
  updated: number;
  /** Slugs present in the database but absent from the config — reported, never deleted. */
  extra: string[];
}

/**
 * Applies categories.config.ts to the database. Validates every definition *before* writing
 * anything, so a typo can't half-apply (same guarantee as syncShelvesFromConfig).
 */
export async function syncCategoriesFromConfig(
  definitions: unknown[],
): Promise<CategorySyncResult> {
  const parsed: CategoryDefinition[] = definitions.map((definition, index) => {
    const result = categoryDefinitionSchema.safeParse(definition);
    if (!result.success) {
      const slug =
        typeof definition === 'object' && definition !== null && 'slug' in definition
          ? String(definition.slug)
          : `#${index}`;
      throw new Error(
        `Invalid category definition "${slug}": ${JSON.stringify(result.error.flatten().fieldErrors)}`,
      );
    }
    return result.data;
  });

  const seen = new Set<string>();
  const seenNames = new Set<string>();
  for (const definition of parsed) {
    if (seen.has(definition.slug)) {
      throw new Error(`Duplicate category slug "${definition.slug}" in config`);
    }
    // `name` is @unique too, so a duplicate would fail mid-sync rather than up front.
    if (seenNames.has(definition.name)) {
      throw new Error(`Duplicate category name "${definition.name}" in config`);
    }
    seen.add(definition.slug);
    seenNames.add(definition.name);
  }

  const existing = await prisma.category.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existing.map((c) => c.slug));

  let created = 0;
  let updated = 0;

  for (const definition of parsed) {
    await prisma.category.upsert({
      where: { slug: definition.slug },
      create: { name: definition.name, slug: definition.slug },
      update: { name: definition.name },
    });
    if (existingSlugs.has(definition.slug)) updated++;
    else created++;
  }

  return {
    created,
    updated,
    extra: existing.map((c) => c.slug).filter((slug) => !seen.has(slug)),
  };
}
