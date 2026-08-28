import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    shelf: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    shelfItem: {
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// The resolvers have their own test file; here they are stubbed so the service's
// snapshot/transaction behaviour is what's under test.
vi.mock('../../../src/modules/shelves/resolvers', () => ({
  resolveShelfItems: vi.fn(),
  parseCriteria: vi.fn(),
}));

import { prisma } from '../../../src/config/database';
import { parseCriteria, resolveShelfItems } from '../../../src/modules/shelves/resolvers';
import {
  getShelfBySlug,
  listActiveShelves,
  refreshAllShelves,
  refreshShelf,
  syncShelvesFromConfig,
} from '../../../src/modules/shelves/shelf.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function buildRecipe(id: string, overrides = {}) {
  return {
    id,
    slug: `recipe-${id}`,
    title: `Recipe ${id}`,
    description: null,
    authorNote: null,
    coverImageUrl: null,
    imageUrls: [],
    videoUrl: null,
    prepTimeMinutes: null,
    difficulty: null,
    averageRating: null,
    reviewCount: 0,
    createdAt: new Date('2024-01-01'),
    author: { id: 'author-uuid', username: 'joao', displayName: 'João' },
    recipeTags: [],
    recipeCategories: [],
    ...overrides,
  };
}

function buildShelf(overrides = {}) {
  return {
    id: 'shelf-uuid',
    slug: 'top-drinks',
    title: 'Top Drinks',
    subtitle: 'Shaken and stirred',
    source: 'query',
    criteria: { category: 'drinks' },
    maxItems: 20,
    position: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
    refreshedAt: new Date('2024-01-02'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockResolvedValue([]);
  // clearAllMocks resets calls but not implementations — re-establish the passthrough default
  // so a test that makes parseCriteria throw doesn't leak into the next one.
  vi.mocked(parseCriteria).mockImplementation((_source, criteria) => criteria);
});

// ─── listActiveShelves ────────────────────────────────────────────────────────

describe('listActiveShelves', () => {
  it('filters to active shelves inside their publish window', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([]);

    await listActiveShelves();

    const where = vi.mocked(prisma.shelf.findMany).mock.calls[0]![0]!.where!;
    expect(where.isActive).toBe(true);
    // A shelf is live when startsAt is null-or-past AND endsAt is null-or-future.
    expect(where.AND).toEqual([
      { OR: [{ startsAt: null }, { startsAt: { lte: expect.any(Date) } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: expect.any(Date) } }] },
    ]);
  });

  it('orders shelves by position and their items by order', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([]);

    await listActiveShelves();

    const args = vi.mocked(prisma.shelf.findMany).mock.calls[0]![0]!;
    expect(args.orderBy).toEqual([{ position: 'asc' }, { createdAt: 'asc' }]);
    expect(args.include!.items!.orderBy).toEqual({ order: 'asc' });
  });

  it('omits shelves that resolve to zero items so no empty row is rendered', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([
      buildShelf({ slug: 'has-items', items: [{ recipe: buildRecipe('r1') }] }),
      buildShelf({ slug: 'empty', items: [] }),
    ] as never);

    const result = await listActiveShelves();

    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe('has-items');
  });

  it('returns items in the stored order, formatted as recipe list items', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([
      buildShelf({
        items: [
          { recipe: buildRecipe('r1', { description: 'x'.repeat(300) }) },
          { recipe: buildRecipe('r2', { recipeTags: [{ tag: { slug: 'vegan' } }] }) },
        ],
      }),
    ] as never);

    const [shelf] = await listActiveShelves();

    expect(shelf!.items.map((i) => i.id)).toEqual(['r1', 'r2']);
    // Same mapper as GET /recipes: description truncated to 200, tags flattened to slugs.
    expect(shelf!.items[0]!.description).toHaveLength(200);
    expect(shelf!.items[1]!.tags).toEqual(['vegan']);
    // criteria is authoring detail and must not leak into the API response.
    expect(shelf).not.toHaveProperty('criteria');
  });
});

// ─── getShelfBySlug ───────────────────────────────────────────────────────────

describe('getShelfBySlug', () => {
  it('returns shelf metadata with a paginated page of items', async () => {
    vi.mocked(prisma.shelf.findFirst).mockResolvedValue(buildShelf() as never);
    vi.mocked(prisma.shelfItem.count).mockResolvedValue(42);
    vi.mocked(prisma.shelfItem.findMany).mockResolvedValue([
      { recipe: buildRecipe('r1') },
    ] as never);

    const result = await getShelfBySlug('top-drinks', { page: 2, limit: 20 });

    expect(result.shelf.slug).toBe('top-drinks');
    expect(result.data).toHaveLength(1);
    expect(result.meta).toMatchObject({ page: 2, limit: 20, total: 42, totalPages: 3 });
    expect(vi.mocked(prisma.shelfItem.findMany).mock.calls[0]![0]).toMatchObject({
      skip: 20,
      take: 20,
      orderBy: { order: 'asc' },
    });
  });

  it('404s for an unknown slug', async () => {
    vi.mocked(prisma.shelf.findFirst).mockResolvedValue(null);

    await expect(getShelfBySlug('nope', { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 404,
      code: 'SHELF_NOT_FOUND',
    });
  });

  it('404s for a shelf outside its publish window (window applied in the lookup)', async () => {
    vi.mocked(prisma.shelf.findFirst).mockResolvedValue(null);

    await expect(getShelfBySlug('spooky', { page: 1, limit: 20 })).rejects.toMatchObject({
      code: 'SHELF_NOT_FOUND',
    });
    // The same active/in-window predicate guards the single-shelf read.
    const where = vi.mocked(prisma.shelf.findFirst).mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({ slug: 'spooky', isActive: true });
    expect(where.AND).toHaveLength(2);
  });
});

// ─── refreshShelf ─────────────────────────────────────────────────────────────

describe('refreshShelf', () => {
  it('rewrites the snapshot in a single transaction, ordered by resolver output', async () => {
    vi.mocked(prisma.shelf.findUnique).mockResolvedValue(buildShelf() as never);
    vi.mocked(resolveShelfItems).mockResolvedValue(['r3', 'r1', 'r2']);

    const count = await refreshShelf('top-drinks');

    expect(count).toBe(3);
    // delete + insert + touch refreshedAt must be atomic: a concurrent read must never
    // observe the shelf mid-rewrite.
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.shelfItem.deleteMany).toHaveBeenCalledWith({ where: { shelfId: 'shelf-uuid' } });
    expect(vi.mocked(prisma.shelfItem.createMany).mock.calls[0]![0]!.data).toEqual([
      { shelfId: 'shelf-uuid', recipeId: 'r3', order: 0 },
      { shelfId: 'shelf-uuid', recipeId: 'r1', order: 1 },
      { shelfId: 'shelf-uuid', recipeId: 'r2', order: 2 },
    ]);
  });

  it('passes the shelf source, criteria and maxItems to the resolver registry', async () => {
    vi.mocked(prisma.shelf.findUnique).mockResolvedValue(
      buildShelf({ source: 'trending', criteria: { windowDays: 14 }, maxItems: 5 }) as never,
    );
    vi.mocked(resolveShelfItems).mockResolvedValue([]);

    await refreshShelf('top-drinks');

    expect(resolveShelfItems).toHaveBeenCalledWith('trending', { windowDays: 14 }, 5);
  });

  it('404s for an unknown slug', async () => {
    vi.mocked(prisma.shelf.findUnique).mockResolvedValue(null);

    await expect(refreshShelf('nope')).rejects.toMatchObject({ code: 'SHELF_NOT_FOUND' });
  });
});

// ─── refreshAllShelves ────────────────────────────────────────────────────────

describe('refreshAllShelves', () => {
  it('keeps going when one shelf fails, reporting per-shelf outcomes', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([
      { slug: 'good-1' },
      { slug: 'broken' },
      { slug: 'good-2' },
    ] as never);
    vi.mocked(prisma.shelf.findUnique).mockImplementation((async (args: {
      where: { slug: string };
    }) => buildShelf({ slug: args.where.slug })) as never);
    vi.mocked(resolveShelfItems).mockImplementation(async (source, criteria, max) => {
      void source;
      void criteria;
      void max;
      return ['r1'];
    });
    // Second shelf blows up; the other two must still be refreshed.
    vi.mocked(resolveShelfItems)
      .mockResolvedValueOnce(['r1'])
      .mockRejectedValueOnce(new Error('resolver exploded'))
      .mockResolvedValueOnce(['r1', 'r2']);

    const results = await refreshAllShelves();

    expect(results).toEqual([
      { slug: 'good-1', count: 1 },
      { slug: 'broken', error: 'resolver exploded' },
      { slug: 'good-2', count: 2 },
    ]);
  });

  it('refreshes only the named shelf when a slug is given', async () => {
    vi.mocked(prisma.shelf.findUnique).mockResolvedValue(buildShelf() as never);
    vi.mocked(resolveShelfItems).mockResolvedValue([]);

    const results = await refreshAllShelves('top-drinks');

    expect(prisma.shelf.findMany).not.toHaveBeenCalled();
    expect(results).toEqual([{ slug: 'top-drinks', count: 0 }]);
  });
});

// ─── syncShelvesFromConfig ────────────────────────────────────────────────────

describe('syncShelvesFromConfig', () => {
  const validDefinition = {
    slug: 'top-drinks',
    title: 'Top Drinks',
    source: 'query',
    criteria: { category: 'drinks' },
  };

  it('upserts each definition and reports created vs updated', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([{ slug: 'top-drinks' }] as never);

    const result = await syncShelvesFromConfig([
      validDefinition,
      { ...validDefinition, slug: 'brand-new' },
    ]);

    expect(result).toMatchObject({ created: 1, updated: 1, deleted: [] });
    expect(prisma.shelf.upsert).toHaveBeenCalledTimes(2);
  });

  it('deletes shelves absent from the config — the file is the source of truth', async () => {
    vi.mocked(prisma.shelf.findMany).mockResolvedValue([
      { slug: 'top-drinks' },
      { slug: 'retired-row' },
    ] as never);

    const result = await syncShelvesFromConfig([validDefinition]);

    expect(result.deleted).toEqual(['retired-row']);
    expect(prisma.shelf.deleteMany).toHaveBeenCalledWith({
      where: { slug: { in: ['retired-row'] } },
    });
  });

  it('rejects a malformed definition naming the slug, before writing anything', async () => {
    await expect(
      syncShelvesFromConfig([{ ...validDefinition, slug: 'Not A Slug' }]),
    ).rejects.toThrow(/Not A Slug/);

    expect(prisma.shelf.upsert).not.toHaveBeenCalled();
    expect(prisma.shelf.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects criteria that fail their resolver schema, before writing anything', async () => {
    vi.mocked(parseCriteria).mockImplementation(() => {
      throw new Error('bad criteria');
    });

    await expect(syncShelvesFromConfig([validDefinition])).rejects.toThrow(/top-drinks/);
    expect(prisma.shelf.upsert).not.toHaveBeenCalled();
  });

  it('rejects duplicate slugs in the config', async () => {
    await expect(
      syncShelvesFromConfig([validDefinition, { ...validDefinition }]),
    ).rejects.toThrow(/Duplicate shelf slug/);

    expect(prisma.shelf.upsert).not.toHaveBeenCalled();
  });
});
