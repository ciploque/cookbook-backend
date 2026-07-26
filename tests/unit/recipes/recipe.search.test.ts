import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearch, mockUpdateDocuments, mockIndex } = vi.hoisted(() => {
  const mockSearch = vi.fn();
  const mockUpdateDocuments = vi.fn().mockResolvedValue(undefined);
  const mockIndex = vi.fn(() => ({ search: mockSearch, updateDocuments: mockUpdateDocuments }));
  return { mockSearch, mockUpdateDocuments, mockIndex };
});

vi.mock('../../../src/config/meilisearch', () => ({
  meiliClient: { index: mockIndex },
  RECIPES_INDEX: 'recipes',
}));

import { searchRecipesViaMeili, updateIndexedRecipeRating } from '../../../src/modules/recipes/recipe.search';

const baseHit = {
  id: 'r1',
  slug: 'test-abcd',
  title: 'Test Recipe',
  description: null,
  category: 'pasta',
  coverImageUrl: null,
  imageUrls: [],
  prepTimeMinutes: null,
  difficulty: null,
  authorId: 'author-uuid',
  author: { id: 'author-uuid', username: 'joao', displayName: 'João' },
  tags: [],
  averageRating: null,
  reviewCount: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

// ─── searchRecipesViaMeili — pagination ───────────────────────────────────────

describe('searchRecipesViaMeili() — page and limit', () => {
  it('passes page=1 and hitsPerPage=20 for page=1, limit=20', async () => {
    mockSearch.mockResolvedValue({ hits: [], totalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ page: 1, hitsPerPage: 20 }),
    );
  });

  it('passes page=2 and hitsPerPage=20 for page=2, limit=20', async () => {
    mockSearch.mockResolvedValue({ hits: [], totalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 2, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ page: 2, hitsPerPage: 20 }),
    );
  });

  it('builds correct meta from totalHits', async () => {
    mockSearch.mockResolvedValue({ hits: [baseHit], totalHits: 55 });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 2, limit: 10, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.meta).toMatchObject({
      page: 2,
      limit: 10,
      total: 55,
      totalPages: 6,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it('returns hasNextPage=false on the last page', async () => {
    mockSearch.mockResolvedValue({ hits: [baseHit], totalHits: 20 });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 2, limit: 10, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.meta).toMatchObject({ hasNextPage: false, hasPrevPage: true });
  });

  it('returns hasPrevPage=false on the first page', async () => {
    mockSearch.mockResolvedValue({ hits: [baseHit], totalHits: 50 });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 10, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.meta).toMatchObject({ hasNextPage: true, hasPrevPage: false });
  });

  it('truncates description to 200 characters in search results', async () => {
    const longDesc = 'x'.repeat(300);
    mockSearch.mockResolvedValue({
      hits: [{ ...baseHit, description: longDesc }],
      totalHits: 1,
    });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.data[0].description).toHaveLength(200);
  });
});

describe('searchRecipesViaMeili() — filter string escaping', () => {
  it('escapes double quotes and backslashes in category', async () => {
    mockSearch.mockResolvedValue({ hits: [], totalHits: 0 });

    await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc',
      category: 'cooking" OR authorId != "00000000',
    });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({
        filter: ['category = "cooking\\" OR authorId != \\"00000000"'],
      }),
    );
  });

  it('escapes double quotes in tag slugs', async () => {
    mockSearch.mockResolvedValue({ hits: [], totalHits: 0 });

    await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc',
      tags: 'italian" OR 1=1,pasta',
    });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({
        filter: ['tags = "italian\\" OR 1=1"', 'tags = "pasta"'],
      }),
    );
  });
});

// ─── searchRecipesViaMeili — filters ──────────────────────────────────────────

describe('searchRecipesViaMeili() — minRating filter', () => {
  it('adds an averageRating filter clause when minRating is provided', async () => {
    mockSearch.mockResolvedValue({ hits: [], totalHits: 0 });

    await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc', minRating: 4,
    });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ filter: expect.arrayContaining(['averageRating >= 4']) }),
    );
  });

  it('omits the averageRating filter when minRating is not provided', async () => {
    mockSearch.mockResolvedValue({ hits: [], totalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith('pasta', expect.objectContaining({ filter: undefined }));
  });
});

// ─── updateIndexedRecipeRating ────────────────────────────────────────────────

describe('updateIndexedRecipeRating()', () => {
  it('sends a partial document update with the recomputed rating stats', async () => {
    await updateIndexedRecipeRating('r1', 4.5, 3);

    expect(mockUpdateDocuments).toHaveBeenCalledWith([
      { id: 'r1', averageRating: 4.5, reviewCount: 3 },
    ]);
  });
});
