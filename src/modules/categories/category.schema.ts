import { z } from 'zod';

// Categories are curated, not user-generated, so the only thing that needs validating is the
// checked-in registry itself (categories.config.ts) — `GET /categories` takes no input and
// there are no write routes. Same reasoning as shelfDefinitionSchema.
export const categoryDefinitionSchema = z.object({
  name: z.string().min(1).max(60),
  // URL-safe: the slug is what recipes reference and what `?category=` filters on.
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens'),
});

export type CategoryDefinition = z.infer<typeof categoryDefinitionSchema>;
