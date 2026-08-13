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

export type ProvisionUserInput = z.infer<typeof provisionUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
