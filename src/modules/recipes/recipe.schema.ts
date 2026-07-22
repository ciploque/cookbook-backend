import { z } from 'zod';

const ingredientSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().min(0).optional(),
  unit: z.string().optional(),
  notes: z.string().optional(),
});

const stepSchema = z.object({
  order: z.number().int().min(1),
  instruction: z.string().min(1),
  imageUrl: z.string().url().optional(),
});

export const createRecipeSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
  prepTimeMinutes: z.number().int().min(0).optional(),
  servings: z.number().int().min(1).optional(),
  difficulty: z.number().int().min(0).optional(),
  coverImageUrl: z.string().url().optional(),
  imageUrls: z.array(z.string().url()).default([]),
  ingredients: z.array(ingredientSchema).default([]),
  steps: z.array(stepSchema).default([]),
});

export const updateRecipeSchema = createRecipeSchema;

export const patchRecipeSchema = createRecipeSchema.partial();

export const recipeQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.string().optional(),
  category: z.string().optional(),
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
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;
