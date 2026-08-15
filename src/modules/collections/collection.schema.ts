import { z } from 'zod';

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(false),
});

export const updateCollectionSchema = createCollectionSchema;

export const patchCollectionSchema = createCollectionSchema.partial();

export const addRecipesSchema = z.object({
  recipes: z
    .array(
      z.object({
        recipeId: z.string().uuid(),
        order: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
});

export const removeRecipesSchema = z.object({
  recipeIds: z.array(z.string().uuid()).min(1).max(100),
});

export const collectionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// See the note on recipeParamsSchema in recipe.schema.ts — uuid params are validated
// before they reach Prisma, and each schema declares every param on its route.
export const collectionParamsSchema = z.object({
  collectionId: z.string().uuid(),
});

export const userCollectionsParamsSchema = z.object({
  userId: z.string().uuid(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type PatchCollectionInput = z.infer<typeof patchCollectionSchema>;
export type AddRecipesInput = z.infer<typeof addRecipesSchema>;
export type RemoveRecipesInput = z.infer<typeof removeRecipesSchema>;
export type CollectionQuery = z.infer<typeof collectionQuerySchema>;
