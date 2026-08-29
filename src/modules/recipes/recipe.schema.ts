import { z } from 'zod';
import { trustedImageUrlSchema } from '../../utils/imageUrl';
import { trustedVideoUrlSchema } from '../../utils/videoUrl';
import { generateRecipeSlug } from '../../utils/slugify';

// `slugify` keeps only [a-z0-9-], so a title made entirely of characters it strips (emoji, CJK,
// punctuation) produces '' — and one of only separators produces '-'. Either way the recipe would
// be unreachable through GET /users/:username/recipes/:recipename and would occupy the author's
// [authorId, slug] slot for every other such title. Rejected here rather than papered over with a
// fallback slug: the title is the author's to fix, and a generated stand-in would be a URL they
// never chose. The check runs on the generator's output, not on the title, so it tracks whatever
// generateRecipeSlug does.
const titleSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((title) => /[a-z0-9]/.test(generateRecipeSlug(title)), {
    message: 'Title must contain at least one letter or number',
  });

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
  title: titleSchema,
  description: z.string().max(2000).optional(),
  authorNote: z.string().max(300).optional(),
  // Category *slugs*, resolved against the curated Category table by the service — an unknown
  // slug is a 422, unlike tags which are created on the fly. Lowercased here so the lookup is
  // a plain equality match against `Category.slug`, which is unique and therefore indexed.
  categories: z.array(z.string().min(1).trim().toLowerCase()).max(5).default([]),
  tags: z.array(z.string().min(1)).max(20).default([]),
  videoUrl: trustedVideoUrlSchema.optional(),
  prepTimeMinutes: z.number().int().min(0).optional(),
  servings: z.number().int().min(1).optional(),
  difficulty: z.number().int().min(0).optional(),
  ingredients: z.array(ingredientSchema).max(200).default([]),
  // `order` is unique per recipe at the DB level (@@unique([recipeId, order])). Checked here so a
  // duplicate is a field-level 422 rather than a P2002 surfacing from inside the write — which
  // the service can no longer mistake for the [authorId, slug] title conflict.
  steps: z
    .array(stepSchema)
    .max(100)
    .refine((steps) => new Set(steps.map((s) => s.order)).size === steps.length, {
      message: 'Step order values must be unique',
    })
    .default([]),
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
  // A single category slug; a recipe matches if it carries that category among its own.
  category: z.string().max(100).trim().toLowerCase().optional(),
  authorId: z.string().uuid().optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title', 'averageRating']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// Route params carrying a uuid must be validated before they reach Prisma — a malformed
// value against a `@db.Uuid` column raises P2023, which would surface as a 500 instead of
// a 422. Each schema must declare *every* param on its route: `validate` replaces
// req.params with the parsed object, and Zod strips keys the schema doesn't mention.
export const recipeParamsSchema = z.object({
  recipeId: z.string().uuid(),
});

export const userRecipesParamsSchema = z.object({
  userId: z.string().uuid(),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type PatchRecipeInput = z.infer<typeof patchRecipeSchema>;
export type RemoveGalleryImagesInput = z.infer<typeof removeGalleryImagesSchema>;
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;
