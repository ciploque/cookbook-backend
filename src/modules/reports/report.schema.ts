import { z } from 'zod';

export const reportTargetTypeValues = ['recipe', 'review', 'user'] as const;

// No endpoint sets this yet — it exists so a future moderation queue has somewhere
// to write without a migration.
export const reportStatusValues = ['pending', 'reviewed', 'dismissed'] as const;

// Topics are per target type — a recipe report and a review report describe
// different problems. Add a sibling list (and a sibling create schema) when
// reviews/users become reportable.
export const recipeReportTopicValues = [
  'spam',
  'inappropriate_content',
  'copyright',
  'dangerous_instructions',
  'misleading_recipe',
  'other',
] as const;

export const createRecipeReportSchema = z.object({
  topic: z.enum(recipeReportTopicValues),
  message: z.string().max(2000).optional(),
});

export const recipeReportParamsSchema = z.object({
  recipeId: z.string().uuid(),
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateRecipeReportInput = z.infer<typeof createRecipeReportSchema>;
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportTargetType = (typeof reportTargetTypeValues)[number];
export type RecipeReportTopic = (typeof recipeReportTopicValues)[number];
