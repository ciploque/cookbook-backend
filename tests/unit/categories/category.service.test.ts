import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    category: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from '../../../src/config/database';
import {
  listCategories,
  resolveCategories,
  syncCategoriesFromConfig,
} from '../../../src/modules/categories/category.service';

const dessert = { id: 'cat-1', name: 'Desserts', slug: 'desserts' };
const drinks = { id: 'cat-2', name: 'Drinks', slug: 'drinks' };

beforeEach(() => vi.clearAllMocks());

// ─── listCategories ───────────────────────────────────────────────────────────

describe('listCategories()', () => {
  it('flattens the _count relation into recipeCount and orders by name', async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { ...dessert, _count: { recipeCategories: 42 } },
      { ...drinks, _count: { recipeCategories: 0 } },
    ] as never);

    const result = await listCategories();

    expect(result).toEqual([
      { id: 'cat-1', name: 'Desserts', slug: 'desserts', recipeCount: 42 },
      // A curated category with no recipes is still a real nav entry — not filtered out.
      { id: 'cat-2', name: 'Drinks', slug: 'drinks', recipeCount: 0 },
    ]);
    expect(vi.mocked(prisma.category.findMany).mock.calls[0][0]).toMatchObject({
      orderBy: { name: 'asc' },
    });
  });

  it('returns an empty array when nothing has been synced yet', async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([]);

    expect(await listCategories()).toEqual([]);
  });
});

// ─── resolveCategories ────────────────────────────────────────────────────────

describe('resolveCategories()', () => {
  it('returns an empty array without hitting the database when given no slugs', async () => {
    expect(await resolveCategories([])).toEqual([]);
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it('resolves known slugs in a single query, de-duplicating the input', async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([dessert, drinks] as never);

    const result = await resolveCategories(['desserts', 'drinks', 'desserts']);

    expect(result).toEqual([dessert, drinks]);
    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['desserts', 'drinks'] } },
    });
  });

  it('throws 422 naming every unknown slug — categories are curated, never created on the fly', async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([dessert] as never);

    await expect(resolveCategories(['desserts', 'dessrt', 'nope'])).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      details: { categories: ['Unknown category: dessrt', 'Unknown category: nope'] },
    });
  });
});

// ─── syncCategoriesFromConfig ─────────────────────────────────────────────────

describe('syncCategoriesFromConfig()', () => {
  it('counts creates vs updates against what already exists', async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([{ slug: 'drinks' }] as never);

    const result = await syncCategoriesFromConfig([
      { name: 'Drinks', slug: 'drinks' },
      { name: 'Desserts', slug: 'desserts' },
    ]);

    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(prisma.category.upsert).toHaveBeenCalledTimes(2);
  });

  it('reports categories absent from the config without deleting them', async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { slug: 'drinks' },
      { slug: 'retired' },
    ] as never);

    const result = await syncCategoriesFromConfig([{ name: 'Drinks', slug: 'drinks' }]);

    // Deleting would cascade through recipe_categories and silently unlabel recipes.
    expect(result.extra).toEqual(['retired']);
  });

  it('rejects a malformed definition before any write happens', async () => {
    await expect(
      syncCategoriesFromConfig([{ name: 'Bad Slug', slug: 'Not A Slug' }]),
    ).rejects.toThrow(/Invalid category definition "Not A Slug"/);

    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.category.upsert).not.toHaveBeenCalled();
  });

  it('rejects duplicate slugs and duplicate names before any write happens', async () => {
    await expect(
      syncCategoriesFromConfig([
        { name: 'Drinks', slug: 'drinks' },
        { name: 'Beverages', slug: 'drinks' },
      ]),
    ).rejects.toThrow(/Duplicate category slug "drinks"/);

    await expect(
      syncCategoriesFromConfig([
        { name: 'Drinks', slug: 'drinks' },
        { name: 'Drinks', slug: 'beverages' },
      ]),
    ).rejects.toThrow(/Duplicate category name "Drinks"/);

    expect(prisma.category.upsert).not.toHaveBeenCalled();
  });
});
