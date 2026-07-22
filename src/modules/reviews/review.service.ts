import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { updateIndexedRecipeRating } from '../recipes/recipe.search';
import { CreateReviewInput, ReviewQuery } from './review.schema';

const reviewInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.ReviewInclude;

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

  const { page, limit } = query;
  const skip = toSkip(page, limit);

  const [total, reviews] = await Promise.all([
    prisma.review.count({ where: { recipeId } }),
    prisma.review.findMany({
      where: { recipeId },
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    data: reviews.map(formatReview),
    meta: buildMeta(page, limit, total),
  };
}

export async function createReview(authProviderId: string, input: CreateReviewInput) {
  const author = await prisma.user.findUnique({ where: { authProviderId } });
  if (!author) throw ApiError.notFound('User');

  const recipe = await prisma.recipe.findUnique({ where: { id: input.recipeId }, select: { id: true } });
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
        WHERE id = ${input.recipeId}
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
