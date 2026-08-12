import { z } from 'zod';
import { trustedImageUrlSchema } from '../../utils/imageUrl';
import { trustedVideoUrlSchema } from '../../utils/videoUrl';

const ingredientSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().min(0).optional(),
  unit: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

const stepSchema = z.object({
  order: z.number().int().min(1),
  instruction: z.string().min(1).max(2000),
  imageUrl: trustedImageUrlSchema.optional(),
});

export const createRecipeSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  authorNote: z.string().max(300).optional(),
  // Normalized to lowercase so filtering can use a plain equality match against the
  // existing `@@index([category])` — a case-insensitive Prisma filter (`mode: 'insensitive'`)
  // can't use that index and would force a sequential scan as the table grows.
  category: z.string().min(1).trim().toLowerCase().optional(),
  tags: z.array(z.string().min(1)).max(20).default([]),
  videoUrl: trustedVideoUrlSchema.optional(),
  prepTimeMinutes: z.number().int().min(0).optional(),
  servings: z.number().int().min(1).optional(),
  difficulty: z.number().int().min(0).optional(),
  ingredients: z.array(ingredientSchema).max(200).default([]),
  steps: z.array(stepSchema).max(100).default([]),
});

export const updateRecipeSchema = createRecipeSchema;

export const patchRecipeSchema = createRecipeSchema.partial();

export const removeGalleryImagesSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(10),
});

export const recipeQuerySchema = z.object({
  q: z.string().optional(),
  tags: z
    .string()
    .max(500)
    .refine((val) => val.split(',').length <= 20, {
      message: 'A maximum of 20 tags can be filtered at once',
    })
    .optional(),
  category: z.string().max(100).trim().toLowerCase().optional(),
  authorId: z.string().uuid().optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'averageRating']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type PatchRecipeInput = z.infer<typeof patchRecipeSchema>;
export type RemoveGalleryImagesInput = z.infer<typeof removeGalleryImagesSchema>;
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;
