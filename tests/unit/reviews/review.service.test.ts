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
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../../src/modules/recipes/recipe.search', () => ({
  updateIndexedRecipeRating: vi.fn(),
}));

import { prisma } from '../../../src/config/database';
import { updateIndexedRecipeRating } from '../../../src/modules/recipes/recipe.search';
import {
  listReviewsByRecipe,
  createReview,
  getReviewAuthorId,
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
      imageUrls: [],
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
      imageUrls: [],
    });

    expect(updateIndexedRecipeRating).toHaveBeenCalledWith('recipe-uuid', 4.5, 2);
  });

  it('throws USER_NOT_FOUND when the authenticated user has no profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      createReview('user_unknown', { recipeId: 'recipe-uuid', rating: 3, imageUrls: [] }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });

    expect(prisma.recipe.findUnique).not.toHaveBeenCalled();
    expect(prisma.review.create).not.toHaveBeenCalled();
  });

  it('throws RECIPE_NOT_FOUND when recipe does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuthor as never);
    vi.mocked(prisma.recipe.findUnique).mockResolvedValue(null);

    await expect(
      createReview('user_author', { recipeId: 'missing-id', rating: 3, imageUrls: [] }),
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
      createReview('user_author', { recipeId: 'recipe-uuid', rating: 5, imageUrls: [] }),
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
