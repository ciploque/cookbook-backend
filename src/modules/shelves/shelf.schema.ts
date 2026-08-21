import { z } from 'zod';
import { recipeQuerySchema } from '../recipes/recipe.schema';

// Resolver names. Adding a theme *kind* means adding a resolver here and in
// resolvers/index.ts — not a migration; `Shelf.criteria` is JSON.
export const shelfSourceValues = ['query', 'manual', 'trending'] as const;

const MAX_SHELF_ITEMS = 50;

// ── Criteria schemas, one per source — the extension point ──────────────────────────────
// Reuses the recipe query schema so a query-backed shelf inherits exactly the filter
// semantics of GET /recipes (tag AND-ing, category equality, Meilisearch free-text).
// page/limit are excluded: paging is the shelf's own concern, driven by maxItems.
export const queryCriteriaSchema = recipeQuerySchema
  .pick({
    q: true,
    tags: true,
    category: true,
    authorId: true,
    minRating: true,
    sortBy: true,
    order: true,
  })
  .partial();

export const manualCriteriaSchema = z.object({
  recipeIds: z.array(z.string().uuid()).min(1).max(MAX_SHELF_ITEMS),
});

export const trendingCriteriaSchema = z.object({
  windowDays: z.number().int().min(1).max(90).default(7),
  tags: z.string().max(500).optional(),
  category: z.string().max(100).trim().toLowerCase().optional(),
});

// ── Route schemas ───────────────────────────────────────────────────────────────────────
// `slug` is not a UUID, so per the Route Param Validation rule it needs no UUID check
// (same treatment as :username/:recipename) — an unknown value is already a clean 404.
export const shelfParamsSchema = z.object({ slug: z.string().min(1).max(100) });

export const shelfQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ── Config-file schema ──────────────────────────────────────────────────────────────────
// Publish-window dates are written as ISO strings in the config but land as Date in the DB.
// A union piped into coerce (rather than a bare z.coerce.date()) keeps the *input* type
// honest, so shelves.config.ts type-checks with string literals.
const dateInput = z.union([z.string(), z.date()]).pipe(z.coerce.date());

// Validates one entry of shelves.config.ts at sync time. `criteria` is checked separately,
// against the resolver named by `source` — see resolvers/index.ts#parseCriteria.
export const shelfDefinitionSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    title: z.string().min(1).max(120),
    subtitle: z.string().max(200).optional(),
    source: z.enum(shelfSourceValues),
    criteria: z.unknown(),
    maxItems: z.number().int().min(1).max(MAX_SHELF_ITEMS).default(20),
    position: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
    startsAt: dateInput.optional(),
    endsAt: dateInput.optional(),
  })
  .refine((s) => !s.startsAt || !s.endsAt || s.endsAt > s.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type ShelfSource = (typeof shelfSourceValues)[number];
export type QueryCriteria = z.infer<typeof queryCriteriaSchema>;
export type ManualCriteria = z.infer<typeof manualCriteriaSchema>;
export type TrendingCriteria = z.infer<typeof trendingCriteriaSchema>;
export type ShelfQuery = z.infer<typeof shelfQuerySchema>;
export type ShelfDefinition = z.input<typeof shelfDefinitionSchema>;
export type ParsedShelfDefinition = z.output<typeof shelfDefinitionSchema>;
