import { z } from 'zod';
import { trustedImageUrlSchema } from '../../utils/imageUrl';

const usernameField = z
  .string()
  .min(3)
  .max(30)
  .regex(
    /^[a-z0-9_-]+$/,
    'Username may only contain lowercase letters, numbers, hyphens and underscores',
  );

export const provisionUserSchema = z.object({
  username: usernameField,
  displayName: z.string().min(1).max(80),
  avatarUrl: trustedImageUrlSchema.optional(),
});

export const updateUserSchema = z.object({
  username: usernameField.optional(),
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: trustedImageUrlSchema.optional(),
});

// See the note on recipeParamsSchema in recipe.schema.ts — uuid params are validated
// before they reach Prisma. `GET /users/username/:username` is deliberately not
// validated: a username is a plain string, so it can't raise P2023 — an unknown one
// is a clean 404 from the service.
export const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

export type ProvisionUserInput = z.infer<typeof provisionUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
