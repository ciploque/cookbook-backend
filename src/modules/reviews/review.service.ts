import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { updateIndexedRecipeRating } from '../recipes/recipe.search';
import { CreateReviewInput, ReviewFilter, ReviewOrder, ReviewQuery } from './review.schema';

const reviewInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.ReviewInclude;

const RATING_VALUES = [1, 2, 3, 4, 5] as const;

function buildReviewWhere(recipeId: string, filter?: ReviewFilter): Prisma.ReviewWhereInput {
  if (filter === 'media') {
    return { recipeId, imageUrls: { isEmpty: false } };
  }
  if (filter?.startsWith('rating:')) {
    return { recipeId, rating: Number(filter.split(':')[1]) };
  }
  return { recipeId };
}

function buildReviewOrderBy(
  order: ReviewOrder,
): Prisma.ReviewOrderByWithRelationInput | Prisma.ReviewOrderByWithRelationInput[] {
  if (order === 'rating_asc') return [{ rating: 'asc' }, { createdAt: 'desc' }];
  if (order === 'rating_desc') return [{ rating: 'desc' }, { createdAt: 'desc' }];
  return { createdAt: 'desc' };
}

function formatReview(review: Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>) {
  return {
    id: review.id,
    recipeId: review.recipeId,
    rating: review.rating,
    content: review.content,
    imageUrls: review.imageUrls,
    author: review.author,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export async function listReviewsByRecipe(recipeId: string, query: ReviewQuery) {
  const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
  if (!recipe) throw ApiError.notFound('Recipe');

  const { page, limit, filter, order } = query;
  const skip = toSkip(page, limit);
  const where = buildReviewWhere(recipeId, filter);
  const orderBy = buildReviewOrderBy(order);

  const [total, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      include: reviewInclude,
      orderBy,
      skip,
      take: limit,
    }),
  ]);

  return {
    data: reviews.map(formatReview),
    meta: buildMeta(page, limit, total),
  };
}

export async function getReviewStats(recipeId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true, reviewCount: true },
  });
  if (!recipe) throw ApiError.notFound('Recipe');

  const [ratingGroups, mediaCount] = await Promise.all([
    prisma.review.groupBy({
      by: ['rating'],
      where: { recipeId },
      _count: { _all: true },
    }),
    prisma.review.count({ where: { recipeId, imageUrls: { isEmpty: false } } }),
  ]);

  const ratingCounts = Object.fromEntries(RATING_VALUES.map((r) => [String(r), 0])) as Record<
    string,
    number
  >;
  for (const group of ratingGroups) {
    ratingCounts[String(group.rating)] = group._count._all;
  }

  return {
    totalReviews: recipe.reviewCount,
    ratingCounts,
    mediaCount,
  };
}

export async function createReview(authProviderId: string, input: CreateReviewInput) {
  const author = await prisma.user.findUnique({ where: { authProviderId } });
  if (!author) throw ApiError.notFound('User');

  const recipe = await prisma.recipe.findUnique({
    where: { id: input.recipeId },
    select: { id: true },
  });
  if (!recipe) throw ApiError.notFound('Recipe');

  try {
    const [review, stats] = await prisma.$transaction([
      prisma.review.create({
        data: {
          recipeId: input.recipeId,
          authorId: author.id,
          rating: input.rating,
          content: input.content,
          imageUrls: input.imageUrls ?? [],
        },
        include: reviewInclude,
      }),
      prisma.$queryRaw<{ averageRating: number | null; reviewCount: number }[]>`
        UPDATE recipes
        SET "reviewCount" = "reviewCount" + 1,
            "ratingSum" = "ratingSum" + ${input.rating},
            "averageRating" = ("ratingSum" + ${input.rating})::float / ("reviewCount" + 1)
        WHERE id = ${input.recipeId}::uuid
        RETURNING "averageRating", "reviewCount"
      `,
    ]);

    void updateIndexedRecipeRating(input.recipeId, stats[0].averageRating, stats[0].reviewCount);
    return formatReview(review);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('You have already reviewed this recipe');
    }
    throw err;
  }
}

export async function getReviewAuthorId(reviewId: string): Promise<string | null> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: { author: { select: { authProviderId: true } } },
  });
  return review?.author.authProviderId ?? null;
}
