import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    recipe: {
      findUnique: vi.fn(),
    },
    review: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../../src/modules/recipes/recipe.search', () => ({
  updateIndexedRecipeRating: vi.fn(),
}));

vi.mock('../../../src/modules/storage/storage.service', () => ({
  storeImage: vi.fn(),
  deleteImage: vi.fn(),
}));

import { prisma } from '../../../src/config/database';
import { updateIndexedRecipeRating } from '../../../src/modules/recipes/recipe.search';
import { deleteImage, storeImage } from '../../../src/modules/storage/storage.service';
import {
  addReviewImages,
  listReviewsByRecipe,
  createReview,
  getReviewAuthorId,
  getReviewStats,
  removeReviewImages,
} from '../../../src/modules/reviews/review.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAuthor = {
  id: 'author-uuid',
  authProviderId: 'user_author',
  username: 'joao',
  displayName: 'João',
  avatarUrl: null,
};

const mockReview = {
  id: 'review-uuid',
  recipeId: 'recipe-uuid',
  authorId: 'author-uuid',
  rating: 4,
  content: 'Great recipe!',
  imageUrls: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  author: { id: 'author-uuid', username: 'joao', displayName: 'João', avatarUrl: null },
};

const mockRecipe = { id: 'recipe-uuid' };

beforeEach(() => vi.clearAllMocks());

// ─── listReviewsByRecipe ──────────────────────────────────────────────────────

describe('listReviewsByRecipe()', () => {
  it('returns paginated reviews for an existing recipe', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(2);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    const result = await listReviewsByRecipe('recipe-uuid', { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'review-uuid', rating: 4 });
    expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(listReviewsByRecipe('missing-id', { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });

    expect(prisma.review.findMany).not.toHaveBeenCalled();
  });

  it('returns correct pagination meta on page 2', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(45);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    const result = await listReviewsByRecipe('recipe-uuid', { page: 2, limit: 20 });

    expect(result.meta).toMatchObject({ page: 2, hasPrevPage: true, hasNextPage: true });
  });

  it('filters by a single rating when filter is rating:N', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(1);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    await listReviewsByRecipe('recipe-uuid', {
      page: 1,
      limit: 20,
      filter: 'rating:4',
      order: 'newest',
    });

    expect(prisma.review.count).toHaveBeenCalledWith({
      where: { recipeId: 'recipe-uuid', rating: 4 },
    });
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipeId: 'recipe-uuid', rating: 4 } }),
    );
  });

  it('filters to reviews with images when filter is media', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(1);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    await listReviewsByRecipe('recipe-uuid', {
      page: 1,
      limit: 20,
      filter: 'media',
      order: 'newest',
    });

    const expectedWhere = { recipeId: 'recipe-uuid', imageUrls: { isEmpty: false } };
    expect(prisma.review.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });

  it('applies no rating/media filter when filter is omitted', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(2);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    await listReviewsByRecipe('recipe-uuid', { page: 1, limit: 20, order: 'newest' });

    expect(prisma.review.count).toHaveBeenCalledWith({ where: { recipeId: 'recipe-uuid' } });
  });

  it('orders by rating ascending (with createdAt tiebreak) when order is rating_asc', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(1);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    await listReviewsByRecipe('recipe-uuid', { page: 1, limit: 20, order: 'rating_asc' });

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ rating: 'asc' }, { createdAt: 'desc' }] }),
    );
  });

  it('orders by rating descending (with createdAt tiebreak) when order is rating_desc', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(1);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    await listReviewsByRecipe('recipe-uuid', { page: 1, limit: 20, order: 'rating_desc' });

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }] }),
    );
  });

  it('defaults to newest-first ordering when order is newest', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.review.count).mockResolvedValue(1);
    vi.mocked(prisma.review.findMany).mockResolvedValue([mockReview] as never);

    await listReviewsByRecipe('recipe-uuid', { page: 1, limit: 20, order: 'newest' });

    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });
});

// ─── getReviewStats ───────────────────────────────────────────────────────────

describe('getReviewStats()', () => {
  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(getReviewStats('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RECIPE_NOT_FOUND',
    });

    expect(prisma.review.groupBy).not.toHaveBeenCalled();
    expect(prisma.review.count).not.toHaveBeenCalled();
  });

  it('returns totalReviews from the denormalized recipe count, zero-filled rating breakdown, and media count', async () => {
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue({
      id: 'recipe-uuid',
      reviewCount: 42,
    } as never);
    vi.mocked(prisma.review.groupBy).mockResolvedValue([
      { rating: 4, _count: { _all: 10 } },
      { rating: 5, _count: { _all: 24 } },
    ] as never);
    vi.mocked(prisma.review.count).mockResolvedValue(14);

    const result = await getReviewStats('recipe-uuid');

    expect(result).toEqual({
      totalReviews: 42,
      ratingCounts: { '1': 0, '2': 0, '3': 0, '4': 10, '5': 24 },
      mediaCount: 14,
    });
    expect(prisma.review.groupBy).toHaveBeenCalledWith({
      by: ['rating'],
      where: { recipeId: 'recipe-uuid' },
      _count: { _all: true },
    });
    expect(prisma.review.count).toHaveBeenCalledWith({
      where: { recipeId: 'recipe-uuid', imageUrls: { isEmpty: false } },
    });
  });
});

// ─── createReview ─────────────────────────────────────────────────────────────

describe('createReview()', () => {
  it('creates and returns the review', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      mockReview,
      [{ averageRating: 4, reviewCount: 1 }],
    ] as never);

    const result = await createReview('user_author', {
      recipeId: 'recipe-uuid',
      rating: 4,
      content: 'Great recipe!',
    });

    expect(prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipeId: 'recipe-uuid',
          authorId: 'author-uuid',
          rating: 4,
        }),
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'review-uuid', rating: 4 });
  });

  it('casts recipeId to ::uuid in the raw stats-update query (recipes.id is a native uuid column)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      mockReview,
      [{ averageRating: 4, reviewCount: 1 }],
    ] as never);

    await createReview('user_author', {
      recipeId: 'recipe-uuid',
      rating: 4,
    });

    const [strings] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [readonly string[]];
    // The segment right after the recipeId placeholder must start with the cast —
    // without it, Postgres rejects the comparison with "operator does not exist: uuid = text".
    expect(strings[strings.length - 1].trimStart().startsWith('::uuid')).toBe(true);
  });

  it('recomputes and syncs recipe rating stats to Meilisearch', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([
      mockReview,
      [{ averageRating: 4.5, reviewCount: 2 }],
    ] as never);

    await createReview('user_author', {
      recipeId: 'recipe-uuid',
      rating: 4,
    });

    expect(updateIndexedRecipeRating).toHaveBeenCalledWith('recipe-uuid', 4.5, 2);
  });

  it('throws USER_NOT_FOUND when the authenticated user has no profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      createReview('user_unknown', { recipeId: 'recipe-uuid', rating: 3 }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.recipe.findUnique).not.toHaveBeenCalled();
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(
      createReview('user_author', { recipeId: 'missing-id', rating: 3 }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'RECIPE_NOT_FOUND' });

    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('throws CONFLICT when user has already reviewed the recipe', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = Object.assign(new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.0.0',
    }));

    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(mockRecipe as never);
    vi.mocked(prisma.$transaction).mockRejectedValue(p2002);

    await expect(
      createReview('user_author', { recipeId: 'recipe-uuid', rating: 5 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });
});

// ─── getReviewAuthorId ────────────────────────────────────────────────────────

describe('getReviewAuthorId()', () => {
  it('returns the authProviderId of the review author', async () => {
    vi.mocked(prisma.review.findUnique).mockResolvedValue({
      author: { authProviderId: 'user_author' },
    } as never);

    const result = await getReviewAuthorId('review-uuid');
    expect(result).toBe('user_author');
  });

  it('returns null when review does not exist', async () => {
    vi.mocked(prisma.review.findUnique).mockResolvedValue(null);

    const result = await getReviewAuthorId('missing-id');
    expect(result).toBeNull();
  });
});

// ─── addReviewImages ──────────────────────────────────────────────────────────

describe('addReviewImages()', () => {
  it('throws REVIEW_NOT_FOUND when the review does not exist', async () => {
    vi.mocked(prisma.review.findUnique).mockResolvedValue(null);

    await expect(addReviewImages('missing-id', [Buffer.from('x')])).rejects.toMatchObject({
      statusCode: 404,
      code: 'REVIEW_NOT_FOUND',
    });

    expect(storeImage).not.toHaveBeenCalled();
  });

  it('rejects when adding would exceed the 10-image cap', async () => {
    const nearFull = { ...mockReview, imageUrls: Array(9).fill('/reviews/review-uuid/gallery/x.jpg') };
    vi.mocked(prisma.review.findUnique).mockResolvedValue(nearFull as never);

    await expect(
      addReviewImages('review-uuid', [Buffer.from('a'), Buffer.from('b')]),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });

    expect(storeImage).not.toHaveBeenCalled();
  });

  it('stores each buffer under reviews/<id>/gallery then appends via an atomic guarded UPDATE', async () => {
    vi.mocked(prisma.review.findUnique).mockResolvedValue(mockReview as never);
    vi.mocked(storeImage).mockResolvedValue('/reviews/review-uuid/gallery/new.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);

    await addReviewImages('review-uuid', [Buffer.from('x')]);

    expect(storeImage).toHaveBeenCalledWith(Buffer.from('x'), 'reviews/review-uuid/gallery');
    // Append is the atomic raw UPDATE, not a read-then-update via review.update.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.review.update).not.toHaveBeenCalled();
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it('cleans up stored objects and 422s when the atomic guard loses the race', async () => {
    vi.mocked(prisma.review.findUnique).mockResolvedValue(mockReview as never);
    vi.mocked(storeImage).mockResolvedValue('/reviews/review-uuid/gallery/new.jpg');
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never); // concurrent upload won the cap

    await expect(addReviewImages('review-uuid', [Buffer.from('x')])).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    });

    expect(deleteImage).toHaveBeenCalledWith('/reviews/review-uuid/gallery/new.jpg');
  });
});

// ─── removeReviewImages ───────────────────────────────────────────────────────

describe('removeReviewImages()', () => {
  it('throws REVIEW_NOT_FOUND when the review does not exist', async () => {
    vi.mocked(prisma.review.findUnique).mockResolvedValue(null);

    await expect(removeReviewImages('missing-id', ['a.jpg'])).rejects.toMatchObject({
      statusCode: 404,
      code: 'REVIEW_NOT_FOUND',
    });
  });

  it('removes the given paths from imageUrls and deletes them from storage', async () => {
    const withImages = {
      ...mockReview,
      imageUrls: ['/reviews/review-uuid/gallery/a.jpg', '/reviews/review-uuid/gallery/b.jpg'],
    };
    vi.mocked(prisma.review.findUnique).mockResolvedValue(withImages as never);
    vi.mocked(prisma.review.update).mockResolvedValue(mockReview as never);

    await removeReviewImages('review-uuid', ['/reviews/review-uuid/gallery/b.jpg']);

    expect(deleteImage).toHaveBeenCalledWith('/reviews/review-uuid/gallery/b.jpg');
    expect(deleteImage).not.toHaveBeenCalledWith('/reviews/review-uuid/gallery/a.jpg');
    expect(prisma.review.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'review-uuid' },
        data: { imageUrls: ['/reviews/review-uuid/gallery/a.jpg'] },
      }),
    );
  });
});
