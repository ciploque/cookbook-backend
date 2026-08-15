import { z } from 'zod';

export const createReviewSchema = z.object({
  recipeId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  content: z.string().max(2000).optional(),
});

export const removeReviewImagesSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(10),
});

// Not cumulative — one value at a time. `rating:N` filters to a single rating;
// `media` filters to reviews with at least one image attached.
export const reviewFilterValues = [
  'rating:1',
  'rating:2',
  'rating:3',
  'rating:4',
  'rating:5',
  'media',
] as const;

export const reviewOrderValues = ['newest', 'rating_asc', 'rating_desc'] as const;

export const reviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum(reviewFilterValues).optional(),
  order: z.enum(reviewOrderValues).default('newest'),
});

// See the note on recipeParamsSchema in recipe.schema.ts — uuid params are validated
// before they reach Prisma, and each schema declares every param on its route.
export const reviewParamsSchema = z.object({
  reviewId: z.string().uuid(),
});

export const recipeReviewsParamsSchema = z.object({
  recipeId: z.string().uuid(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type RemoveReviewImagesInput = z.infer<typeof removeReviewImagesSchema>;
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
export type ReviewFilter = ReviewQuery['filter'];
export type ReviewOrder = ReviewQuery['order'];
