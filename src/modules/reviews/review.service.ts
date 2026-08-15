import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { updateIndexedRecipeRating } from '../recipes/recipe.search';
import { deleteImage, storeImage } from '../storage/storage.service';
import { CreateReviewInput, ReviewFilter, ReviewOrder, ReviewQuery } from './review.schema';

const reviewInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.ReviewInclude;

const RATING_VALUES = [1, 2, 3, 4, 5] as const;
const MAX_REVIEW_IMAGES = 10;

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
          imageUrls: [],
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

export async function addReviewImages(reviewId: string, buffers: Buffer[]) {
  const existing = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { imageUrls: true },
  });
  if (!existing) throw ApiError.notFound('Review');

  const capMessage = (current: number) =>
    `Maximum of ${MAX_REVIEW_IMAGES} images allowed per review ` +
    `(currently ${current}, tried to add ${buffers.length})`;

  // Fast path: reject an obvious over-cap before spending R2 writes.
  if (existing.imageUrls.length + buffers.length > MAX_REVIEW_IMAGES) {
    throw ApiError.validation({ images: [capMessage(existing.imageUrls.length)] });
  }

  const newKeys = await Promise.all(
    buffers.map((buffer) => storeImage(buffer, `reviews/${reviewId}/gallery`)),
  );

  // Atomic, race-safe capped append: the cap lives in the WHERE clause, so concurrent uploads
  // can neither exceed it nor lose each other's writes (unlike a read-then-update round-trip).
  const affected = await prisma.$executeRaw(Prisma.sql`
    UPDATE "reviews"
    SET "imageUrls" = "imageUrls" || ARRAY[${Prisma.join(newKeys)}]::text[]
    WHERE "id" = ${reviewId}::uuid
      AND cardinality("imageUrls") + ${newKeys.length} <= ${MAX_REVIEW_IMAGES}
  `);

  if (affected === 0) {
    // Lost the race against a concurrent upload — undo the just-stored objects to avoid orphans.
    newKeys.forEach((key) => void deleteImage(key));
    throw ApiError.validation({ images: [capMessage(MAX_REVIEW_IMAGES)] });
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: reviewInclude,
  });
  if (!review) throw ApiError.notFound('Review');

  return formatReview(review);
}

export async function removeReviewImages(reviewId: string, paths: string[]) {
  const existing = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!existing) throw ApiError.notFound('Review');

  const toRemove = new Set(paths);
  const remaining = existing.imageUrls.filter((key) => !toRemove.has(key));
  existing.imageUrls.filter((key) => toRemove.has(key)).forEach((key) => void deleteImage(key));

  const review = await prisma.review.update({
    where: { id: reviewId },
    data: { imageUrls: remaining },
    include: reviewInclude,
  });

  return formatReview(review);
}
