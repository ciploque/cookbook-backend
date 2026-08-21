import { describe, it, expect, vi } from 'vitest';

// queryCriteriaSchema derives from recipeQuerySchema, whose import chain reaches env.ts —
// same mock the recipe schema tests use.
vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import {
  manualCriteriaSchema,
  queryCriteriaSchema,
  shelfDefinitionSchema,
  shelfQuerySchema,
  shelfSourceValues,
  trendingCriteriaSchema,
} from '../../../src/modules/shelves/shelf.schema';
import { shelfDefinitions } from '../../../src/modules/shelves/shelves.config';

const uuid = '01a0219b-189e-7f81-aa47-bd38922adc68';

// ─── Criteria schemas ─────────────────────────────────────────────────────────

describe('queryCriteriaSchema', () => {
  it('accepts a subset of the recipe query filters', () => {
    const parsed = queryCriteriaSchema.parse({
      category: 'DRINKS',
      sortBy: 'averageRating',
      order: 'desc',
      minRating: 4,
    });
    // Inherits the recipe schema's normalisation, so it matches the @@index([category]).
    expect(parsed.category).toBe('drinks');
    expect(parsed.minRating).toBe(4);
  });

  it('accepts an empty object — an unfiltered "everything" shelf is valid', () => {
    expect(queryCriteriaSchema.parse({})).toEqual({});
  });

  it('rejects an invalid sort field and an out-of-range rating', () => {
    expect(queryCriteriaSchema.safeParse({ sortBy: 'popularity' }).success).toBe(false);
    expect(queryCriteriaSchema.safeParse({ minRating: 9 }).success).toBe(false);
  });

  it('strips page/limit — paging is the shelf\'s concern, driven by maxItems', () => {
    expect(queryCriteriaSchema.parse({ page: 3, limit: 40 })).toEqual({});
  });
});

describe('manualCriteriaSchema', () => {
  it('accepts a list of recipe uuids', () => {
    expect(manualCriteriaSchema.parse({ recipeIds: [uuid] }).recipeIds).toEqual([uuid]);
  });

  it('rejects non-uuids, an empty list, and more than 50 ids', () => {
    expect(manualCriteriaSchema.safeParse({ recipeIds: ['nope'] }).success).toBe(false);
    expect(manualCriteriaSchema.safeParse({ recipeIds: [] }).success).toBe(false);
    expect(
      manualCriteriaSchema.safeParse({ recipeIds: Array(51).fill(uuid) }).success,
    ).toBe(false);
  });
});

describe('trendingCriteriaSchema', () => {
  it('defaults the window to 7 days', () => {
    expect(trendingCriteriaSchema.parse({}).windowDays).toBe(7);
  });

  it('rejects a window outside 1–90 days and a non-integer window', () => {
    expect(trendingCriteriaSchema.safeParse({ windowDays: 0 }).success).toBe(false);
    expect(trendingCriteriaSchema.safeParse({ windowDays: 91 }).success).toBe(false);
    expect(trendingCriteriaSchema.safeParse({ windowDays: 1.5 }).success).toBe(false);
  });
});

// ─── Route schemas ────────────────────────────────────────────────────────────

describe('shelfQuerySchema', () => {
  it('defaults page/limit and coerces strings', () => {
    expect(shelfQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(shelfQuerySchema.parse({ page: '2', limit: '5' })).toEqual({ page: 2, limit: 5 });
  });

  it('rejects a limit above 50 and a page below 1', () => {
    expect(shelfQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(shelfQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

// ─── Config definition schema ─────────────────────────────────────────────────

describe('shelfDefinitionSchema', () => {
  const base = { slug: 'top-drinks', title: 'Top Drinks', source: 'query', criteria: {} };

  it('applies defaults for the optional presentation/ordering fields', () => {
    const parsed = shelfDefinitionSchema.parse(base);
    expect(parsed).toMatchObject({ maxItems: 20, position: 0, isActive: true });
  });

  it('enforces a URL-safe slug', () => {
    expect(shelfDefinitionSchema.safeParse({ ...base, slug: 'Top Drinks' }).success).toBe(false);
    expect(shelfDefinitionSchema.safeParse({ ...base, slug: 'top_drinks' }).success).toBe(false);
    expect(shelfDefinitionSchema.safeParse({ ...base, slug: 'top-drinks-2' }).success).toBe(true);
  });

  it('enforces title and subtitle length caps', () => {
    expect(shelfDefinitionSchema.safeParse({ ...base, title: '' }).success).toBe(false);
    expect(shelfDefinitionSchema.safeParse({ ...base, title: 'x'.repeat(121) }).success).toBe(
      false,
    );
    expect(
      shelfDefinitionSchema.safeParse({ ...base, subtitle: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('caps maxItems at 50 — the recipe query limit the query resolver runs under', () => {
    expect(shelfDefinitionSchema.safeParse({ ...base, maxItems: 51 }).success).toBe(false);
    expect(shelfDefinitionSchema.safeParse({ ...base, maxItems: 50 }).success).toBe(true);
  });

  it('rejects an unknown source', () => {
    expect(shelfDefinitionSchema.safeParse({ ...base, source: 'vibes' }).success).toBe(false);
  });

  it('accepts ISO date strings for the publish window and coerces them to Date', () => {
    const parsed = shelfDefinitionSchema.parse({
      ...base,
      startsAt: '2026-10-01',
      endsAt: '2026-11-02',
    });
    expect(parsed.startsAt).toBeInstanceOf(Date);
    expect(parsed.endsAt).toBeInstanceOf(Date);
  });

  it('rejects a window that ends before it starts', () => {
    const result = shelfDefinitionSchema.safeParse({
      ...base,
      startsAt: '2026-11-02',
      endsAt: '2026-10-01',
    });
    expect(result.success).toBe(false);
  });

  it('allows an open-ended window (only one bound set)', () => {
    expect(shelfDefinitionSchema.safeParse({ ...base, startsAt: '2026-10-01' }).success).toBe(
      true,
    );
    expect(shelfDefinitionSchema.safeParse({ ...base, endsAt: '2026-11-02' }).success).toBe(true);
  });
});

// ─── The checked-in registry itself ───────────────────────────────────────────

describe('shelves.config.ts', () => {
  it('every definition is structurally valid', () => {
    for (const definition of shelfDefinitions) {
      const result = shelfDefinitionSchema.safeParse(definition);
      expect(result.success, `${definition.slug}: ${JSON.stringify(result.error?.flatten())}`).toBe(
        true,
      );
    }
  });

  it('every definition\'s criteria satisfies the schema of its declared source', () => {
    const criteriaSchemas = {
      query: queryCriteriaSchema,
      manual: manualCriteriaSchema,
      trending: trendingCriteriaSchema,
    };

    for (const definition of shelfDefinitions) {
      const schema = criteriaSchemas[definition.source as keyof typeof criteriaSchemas];
      const result = schema.safeParse(definition.criteria);
      expect(result.success, `${definition.slug}: ${JSON.stringify(result.error?.flatten())}`).toBe(
        true,
      );
    }
  });

  it('has unique slugs and unique positions', () => {
    const slugs = shelfDefinitions.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const positions = shelfDefinitions.map((d) => d.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('only references sources the registry knows about', () => {
    for (const definition of shelfDefinitions) {
      expect(shelfSourceValues).toContain(definition.source);
    }
  });
});
