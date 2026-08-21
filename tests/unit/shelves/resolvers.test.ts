import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

vi.mock('../../../src/config/database', () => ({
  prisma: {
    recipe: { findMany: vi.fn() },
    review: { groupBy: vi.fn() },
  },
}));

// The query resolver's whole point is delegating to the real listing engine — mock it so we
// can assert exactly what it delegates, without a DB or Meilisearch.
vi.mock('../../../src/modules/recipes/recipe.service', () => ({
  listRecipes: vi.fn(),
}));

import { prisma } from '../../../src/config/database';
import { listRecipes } from '../../../src/modules/recipes/recipe.service';
import {
  getResolver,
  parseCriteria,
  resolveShelfItems,
} from '../../../src/modules/shelves/resolvers';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe('resolver registry', () => {
  it('resolves each known source', () => {
    for (const source of ['query', 'manual', 'trending']) {
      expect(getResolver(source).source).toBe(source);
    }
  });

  it('throws a message listing the known sources for an unknown one', () => {
    expect(() => getResolver('not-real')).toThrow(/Unknown shelf source "not-real"/);
    expect(() => getResolver('not-real')).toThrow(/query, manual, trending/);
  });

  it('validates criteria against the resolver named by source', () => {
    expect(parseCriteria('trending', { windowDays: 14 })).toEqual({ windowDays: 14 });
    // windowDays has a default, so an empty object is valid for trending…
    expect(parseCriteria('trending', {})).toEqual({ windowDays: 7 });
    // …but a wrong type is a validation error, not a silent coercion.
    expect(() => parseCriteria('trending', { windowDays: 'soon' })).toThrow();
    expect(() => parseCriteria('manual', { recipeIds: ['not-a-uuid'] })).toThrow();
  });
});

// ─── query resolver ───────────────────────────────────────────────────────────

describe('query resolver', () => {
  it('delegates to listRecipes with maxItems as the limit and returns ids in order', async () => {
    vi.mocked(listRecipes).mockResolvedValue({
      data: [{ id: 'r1' }, { id: 'r2' }],
      meta: {},
    } as never);

    const ids = await resolveShelfItems(
      'query',
      { category: 'drinks', sortBy: 'averageRating', order: 'desc' },
      15,
    );

    expect(ids).toEqual(['r1', 'r2']);
    expect(listRecipes).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'drinks',
        sortBy: 'averageRating',
        order: 'desc',
        page: 1,
        limit: 15,
      }),
    );
  });

  it('applies recipe query defaults for criteria that omit sort', async () => {
    vi.mocked(listRecipes).mockResolvedValue({ data: [], meta: {} } as never);

    await resolveShelfItems('query', {}, 20);

    expect(listRecipes).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'createdAt', order: 'desc' }),
    );
  });

  it('passes free-text through so the shelf routes to Meilisearch', async () => {
    vi.mocked(listRecipes).mockResolvedValue({ data: [{ id: 'r1' }], meta: {} } as never);

    await resolveShelfItems('query', { q: 'pasta' }, 10);

    expect(listRecipes).toHaveBeenCalledWith(expect.objectContaining({ q: 'pasta' }));
  });
});

// ─── manual resolver ──────────────────────────────────────────────────────────

describe('manual resolver', () => {
  const uuid = (n: number) => `01a0219b-0000-7000-8000-00000000000${n}`;

  it('preserves the authored order rather than the database order', async () => {
    // Prisma returns rows in arbitrary order — the resolver must not adopt it.
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([
      { id: uuid(2) },
      { id: uuid(1) },
      { id: uuid(3) },
    ] as never);

    const ids = await resolveShelfItems(
      'manual',
      { recipeIds: [uuid(1), uuid(2), uuid(3)] },
      20,
    );

    expect(ids).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it('drops ids whose recipe no longer exists instead of failing the refresh', async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([{ id: uuid(1) }] as never);

    const ids = await resolveShelfItems('manual', { recipeIds: [uuid(1), uuid(2)] }, 20);

    expect(ids).toEqual([uuid(1)]);
  });

  it('truncates to maxItems', async () => {
    vi.mocked(prisma.recipe.findMany).mockResolvedValue([{ id: uuid(1) }] as never);

    await resolveShelfItems('manual', { recipeIds: [uuid(1), uuid(2), uuid(3)] }, 1);

    expect(vi.mocked(prisma.recipe.findMany).mock.calls[0]![0]!.where!.id).toEqual({
      in: [uuid(1)],
    });
  });
});

// ─── trending resolver ────────────────────────────────────────────────────────

describe('trending resolver', () => {
  it('counts reviews inside the window, most-reviewed first', async () => {
    vi.mocked(prisma.review.groupBy).mockResolvedValue([
      { recipeId: 'r1', _count: { recipeId: 9 } },
      { recipeId: 'r2', _count: { recipeId: 4 } },
    ] as never);

    const before = Date.now();
    const ids = await resolveShelfItems('trending', { windowDays: 7 }, 10);

    expect(ids).toEqual(['r1', 'r2']);
    const args = vi.mocked(prisma.review.groupBy).mock.calls[0]![0]! as {
      by: string[];
      where: { createdAt: { gte: Date } };
      orderBy: unknown;
      take: number;
    };
    expect(args.by).toEqual(['recipeId']);
    expect(args.orderBy).toEqual({ _count: { recipeId: 'desc' } });
    expect(args.take).toBe(10);

    // The window is 7 days back from "now" (allow a second of slack for test runtime).
    const expected = before - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(args.where.createdAt.gte.getTime() - expected)).toBeLessThan(1000);
  });

  it('defaults the window to 7 days', async () => {
    vi.mocked(prisma.review.groupBy).mockResolvedValue([] as never);

    await resolveShelfItems('trending', {}, 10);

    const args = vi.mocked(prisma.review.groupBy).mock.calls[0]![0]! as {
      where: { createdAt: { gte: Date } };
    };
    const days = (Date.now() - args.where.createdAt.gte.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 1);
  });

  it('applies no recipe filter when neither tags nor category are given', async () => {
    vi.mocked(prisma.review.groupBy).mockResolvedValue([] as never);

    await resolveShelfItems('trending', { windowDays: 30 }, 10);

    const args = vi.mocked(prisma.review.groupBy).mock.calls[0]![0]! as {
      where: Record<string, unknown>;
    };
    expect(args.where).not.toHaveProperty('recipe');
  });

  it('AND-s multiple tags and filters by category, matching listRecipes semantics', async () => {
    vi.mocked(prisma.review.groupBy).mockResolvedValue([] as never);

    await resolveShelfItems(
      'trending',
      { windowDays: 7, tags: 'vegan, quick', category: 'dessert' },
      10,
    );

    const args = vi.mocked(prisma.review.groupBy).mock.calls[0]![0]! as {
      where: { recipe: { category: string; AND: unknown[] } };
    };
    expect(args.where.recipe.category).toBe('dessert');
    expect(args.where.recipe.AND).toEqual([
      { recipeTags: { some: { tag: { slug: 'vegan' } } } },
      { recipeTags: { some: { tag: { slug: 'quick' } } } },
    ]);
  });
});
