import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { formatRecipeListItem, recipeListSelect } from '../recipes/recipe.service';
import { parseCriteria, resolveShelfItems } from './resolvers';
import { ParsedShelfDefinition, ShelfQuery, shelfDefinitionSchema } from './shelf.schema';

const shelfItemInclude = {
  recipe: { select: recipeListSelect },
} satisfies Prisma.ShelfItemInclude;

type ShelfItemPayload = Prisma.ShelfItemGetPayload<{ include: typeof shelfItemInclude }>;

function formatShelfMeta(shelf: {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  source: string;
  position: number;
  refreshedAt: Date | null;
}) {
  return {
    id: shelf.id,
    slug: shelf.slug,
    title: shelf.title,
    subtitle: shelf.subtitle,
    source: shelf.source,
    position: shelf.position,
    refreshedAt: shelf.refreshedAt,
  };
}

// `criteria` is deliberately not exposed: it is authoring detail, and a shelf's contents are
// already fully described by its items.
function formatShelfItems(items: ShelfItemPayload[]) {
  return items.map((item) => formatRecipeListItem(item.recipe));
}

/** A shelf is live when it is active and `now` falls inside its (optional) publish window. */
function activeShelfWhere(now: Date): Prisma.ShelfWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

/**
 * The landing page: every live shelf with its items, in one query.
 *
 * Because contents are a precomputed snapshot, this costs the same whether a shelf is a
 * trivial `sortBy=createdAt` or an expensive trending aggregate.
 */
export async function listActiveShelves() {
  const shelves = await prisma.shelf.findMany({
    where: activeShelfWhere(new Date()),
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      items: {
        orderBy: { order: 'asc' },
        include: shelfItemInclude,
      },
    },
  });

  // Omit empty shelves so the frontend never renders a headed row with nothing in it —
  // e.g. a seasonal shelf whose tag has no recipes yet, or one never refreshed.
  return shelves
    .filter((shelf) => shelf.items.length > 0)
    .map((shelf) => ({
      ...formatShelfMeta(shelf),
      items: formatShelfItems(shelf.items),
    }));
}

/** One shelf's full contents, paginated — the "see all" page behind a row. */
export async function getShelfBySlug(slug: string, query: ShelfQuery) {
  const shelf = await prisma.shelf.findFirst({
    where: { slug, ...activeShelfWhere(new Date()) },
  });
  if (!shelf) throw ApiError.notFound('Shelf');

  const { page, limit } = query;
  const skip = toSkip(page, limit);

  const [total, items] = await Promise.all([
    prisma.shelfItem.count({ where: { shelfId: shelf.id } }),
    prisma.shelfItem.findMany({
      where: { shelfId: shelf.id },
      include: shelfItemInclude,
      orderBy: { order: 'asc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    shelf: formatShelfMeta(shelf),
    data: formatShelfItems(items),
    meta: buildMeta(page, limit, total),
  };
}

/**
 * Re-resolves a shelf's criteria and rewrites its snapshot.
 *
 * The delete+insert runs in one transaction so a concurrent read never observes a shelf
 * mid-rewrite (it sees either the old contents or the new ones, never an empty row).
 */
export async function refreshShelf(slug: string): Promise<number> {
  const shelf = await prisma.shelf.findUnique({ where: { slug } });
  if (!shelf) throw ApiError.notFound('Shelf');

  const recipeIds = await resolveShelfItems(shelf.source, shelf.criteria, shelf.maxItems);

  await prisma.$transaction([
    prisma.shelfItem.deleteMany({ where: { shelfId: shelf.id } }),
    prisma.shelfItem.createMany({
      data: recipeIds.map((recipeId, index) => ({
        shelfId: shelf.id,
        recipeId,
        order: index,
      })),
      // A resolver could in principle return the same id twice; the composite PK would
      // reject the whole batch, so tolerate it rather than failing the refresh.
      skipDuplicates: true,
    }),
    prisma.shelf.update({
      where: { id: shelf.id },
      data: { refreshedAt: new Date() },
    }),
  ]);

  return recipeIds.length;
}

export interface RefreshResult {
  slug: string;
  count?: number;
  error?: string;
}

/**
 * Refreshes every shelf (or just the named one). A shelf whose criteria fail to resolve is
 * reported and skipped — one broken shelf must not leave the rest of the landing page stale.
 */
export async function refreshAllShelves(slug?: string): Promise<RefreshResult[]> {
  const shelves = slug
    ? [{ slug }]
    : await prisma.shelf.findMany({ select: { slug: true }, orderBy: { position: 'asc' } });

  const results: RefreshResult[] = [];
  for (const shelf of shelves) {
    try {
      results.push({ slug: shelf.slug, count: await refreshShelf(shelf.slug) });
    } catch (err) {
      results.push({ slug: shelf.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: string[];
}

/**
 * Applies the checked-in registry to the database.
 *
 * The config file is the source of truth, so shelves absent from it are deleted (cascading
 * their items). Every definition is validated — shape *and* criteria-against-its-resolver —
 * before anything is written, so a typo can't leave the table half-applied.
 */
export async function syncShelvesFromConfig(definitions: unknown[]): Promise<SyncResult> {
  const parsed: ParsedShelfDefinition[] = definitions.map((definition, index) => {
    const result = shelfDefinitionSchema.safeParse(definition);
    if (!result.success) {
      const slug =
        typeof definition === 'object' && definition !== null && 'slug' in definition
          ? String(definition.slug)
          : `#${index}`;
      throw new Error(
        `Invalid shelf definition "${slug}": ${JSON.stringify(result.error.flatten().fieldErrors)}`,
      );
    }
    return result.data;
  });

  const seen = new Set<string>();
  for (const definition of parsed) {
    if (seen.has(definition.slug)) {
      throw new Error(`Duplicate shelf slug "${definition.slug}" in config`);
    }
    seen.add(definition.slug);

    // Validate criteria against the resolver named by `source` before any write happens.
    try {
      parseCriteria(definition.source, definition.criteria);
    } catch (err) {
      throw new Error(
        `Invalid criteria for shelf "${definition.slug}" (source "${definition.source}"): ${
          err instanceof ApiError ? JSON.stringify(err.details) : String(err)
        }`,
        { cause: err },
      );
    }
  }

  const existing = await prisma.shelf.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existing.map((s) => s.slug));
  const obsolete = existing.map((s) => s.slug).filter((s) => !seen.has(s));

  let created = 0;
  let updated = 0;

  for (const definition of parsed) {
    const data = {
      title: definition.title,
      subtitle: definition.subtitle ?? null,
      source: definition.source,
      criteria: definition.criteria as Prisma.InputJsonValue,
      maxItems: definition.maxItems,
      position: definition.position,
      isActive: definition.isActive,
      startsAt: definition.startsAt ?? null,
      endsAt: definition.endsAt ?? null,
    };

    await prisma.shelf.upsert({
      where: { slug: definition.slug },
      create: { slug: definition.slug, ...data },
      update: data,
    });

    if (existingSlugs.has(definition.slug)) updated += 1;
    else created += 1;
  }

  if (obsolete.length > 0) {
    await prisma.shelf.deleteMany({ where: { slug: { in: obsolete } } });
  }

  return { created, updated, deleted: obsolete };
}
