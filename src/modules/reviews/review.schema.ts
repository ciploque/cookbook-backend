import { z } from 'zod';
import { trustedImageUrlSchema } from '../../utils/imageUrl';

export const createReviewSchema = z.object({
  recipeId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  content: z.string().max(2000).optional(),
  imageUrls: z.array(trustedImageUrlSchema).max(10).optional().default([]),
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

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
export type ReviewFilter = ReviewQuery['filter'];
export type ReviewOrder = ReviewQuery['order'];
