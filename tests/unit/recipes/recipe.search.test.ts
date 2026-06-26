import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearch, mockIndex } = vi.hoisted(() => {
  const mockSearch = vi.fn();
  const mockIndex = vi.fn(() => ({ search: mockSearch }));
  return { mockSearch, mockIndex };
});

vi.mock('../../../src/config/meilisearch', () => ({
  meiliClient: { index: mockIndex },
  RECIPES_INDEX: 'recipes',
}));

import { searchRecipesViaMeili } from '../../../src/modules/recipes/recipe.search';

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
  createdAt: '2024-01-01T00:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

// ─── searchRecipesViaMeili — pagination ───────────────────────────────────────

describe('searchRecipesViaMeili() — page and limit', () => {
  it('passes offset=0 and limit=20 for page=1, limit=20', async () => {
    mockSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ offset: 0, limit: 20 }),
    );
  });

  it('passes offset=20 and limit=20 for page=2, limit=20', async () => {
    mockSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 2, limit: 20, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ offset: 20, limit: 20 }),
    );
  });

  it('passes offset=10 and limit=10 for page=2, limit=10', async () => {
    mockSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 2, limit: 10, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ offset: 10, limit: 10 }),
    );
  });

  it('passes offset=40 and limit=5 for page=9, limit=5', async () => {
    mockSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 });

    await searchRecipesViaMeili({ q: 'pasta', page: 9, limit: 5, sortBy: 'createdAt', order: 'desc' });

    expect(mockSearch).toHaveBeenCalledWith(
      'pasta',
      expect.objectContaining({ offset: 40, limit: 5 }),
    );
  });

  it('builds correct meta from estimatedTotalHits', async () => {
    mockSearch.mockResolvedValue({ hits: [baseHit], estimatedTotalHits: 55 });

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
    mockSearch.mockResolvedValue({ hits: [baseHit], estimatedTotalHits: 20 });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 2, limit: 10, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.meta).toMatchObject({ hasNextPage: false, hasPrevPage: true });
  });

  it('returns hasPrevPage=false on the first page', async () => {
    mockSearch.mockResolvedValue({ hits: [baseHit], estimatedTotalHits: 50 });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 10, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.meta).toMatchObject({ hasNextPage: true, hasPrevPage: false });
  });

  it('truncates description to 200 characters in search results', async () => {
    const longDesc = 'x'.repeat(300);
    mockSearch.mockResolvedValue({
      hits: [{ ...baseHit, description: longDesc }],
      estimatedTotalHits: 1,
    });

    const result = await searchRecipesViaMeili({
      q: 'pasta', page: 1, limit: 20, sortBy: 'createdAt', order: 'desc',
    });

    expect(result.data[0].description).toHaveLength(200);
  });
});
