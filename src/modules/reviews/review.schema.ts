import { z } from 'zod';

export const createReviewSchema = z.object({
  recipeId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  content: z.string().max(2000).optional(),
  imageUrls: z.array(z.string().url()).optional().default([]),
});

export const reviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ReviewQuery = z.infer<typeof reviewQuerySchema>;
