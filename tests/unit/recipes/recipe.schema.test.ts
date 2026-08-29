import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import {
  createRecipeSchema,
  patchRecipeSchema,
  recipeQuerySchema,
  updateRecipeSchema,
} from '../../../src/modules/recipes/recipe.schema';
import { generateRecipeSlug } from '../../../src/utils/slugify';

describe('createRecipeSchema — categories', () => {
  const base = { title: 'Test', tags: [], ingredients: [], steps: [] };

  it('lowercases and trims every category slug on write', () => {
    const result = createRecipeSchema.parse({ ...base, categories: ['  Pasta  ', 'VEGAN'] });
    expect(result.categories).toEqual(['pasta', 'vegan']);
  });

  it('defaults to an empty array when omitted', () => {
    expect(createRecipeSchema.parse(base).categories).toEqual([]);
  });

  it('rejects more than 5 categories and empty slugs', () => {
    expect(
      createRecipeSchema.safeParse({ ...base, categories: ['a', 'b', 'c', 'd', 'e', 'f'] }).success,
    ).toBe(false);
    expect(createRecipeSchema.safeParse({ ...base, categories: [''] }).success).toBe(false);
  });
});

describe('createRecipeSchema — videoUrl', () => {
  const base = { title: 'Test', tags: [], ingredients: [], steps: [] };

  it('accepts a valid YouTube URL', () => {
    const result = createRecipeSchema.safeParse({
      ...base,
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a URL from a disallowed host', () => {
    const result = createRecipeSchema.safeParse({
      ...base,
      videoUrl: 'https://evil.com/video.mp4',
    });
    expect(result.success).toBe(false);
  });
});

describe('createRecipeSchema — authorNote', () => {
  const base = { title: 'Test', tags: [], ingredients: [], steps: [] };

  it('accepts a note within 300 chars', () => {
    const result = createRecipeSchema.safeParse({ ...base, authorNote: 'A family favorite' });
    expect(result.success).toBe(true);
  });

  it('rejects a note over 300 chars', () => {
    const result = createRecipeSchema.safeParse({ ...base, authorNote: 'a'.repeat(301) });
    expect(result.success).toBe(false);
  });

  it('allows omitting authorNote', () => {
    const result = createRecipeSchema.safeParse(base);
    expect(result.success).toBe(true);
  });
});

describe('recipeQuerySchema — category normalization', () => {
  // The filter param stays a single slug even though a recipe can now carry several.
  it('lowercases and trims the category filter the same way as write', () => {
    const result = recipeQuerySchema.parse({ category: '  Pasta  ' });
    expect(result.category).toBe('pasta');
  });
});

describe('recipeQuerySchema — tags count cap', () => {
  it('accepts up to 20 comma-separated tags', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`).join(',');
    const result = recipeQuerySchema.safeParse({ tags });
    expect(result.success).toBe(true);
  });

  it('rejects more than 20 comma-separated tags', () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`).join(',');
    const result = recipeQuerySchema.safeParse({ tags });
    expect(result.success).toBe(false);
  });
});

describe('createRecipeSchema — step order uniqueness', () => {
  const base = { title: 'Pasta' };

  it('accepts steps with distinct order values', () => {
    const result = createRecipeSchema.safeParse({
      ...base,
      steps: [
        { order: 1, instruction: 'Boil' },
        { order: 2, instruction: 'Drain' },
      ],
    });
    expect(result.success).toBe(true);
  });

  // Enforced by @@unique([recipeId, order]) at the DB level. Checked here so it lands as a 422
  // instead of a P2002 the service would have to disambiguate from the title conflict.
  it('rejects duplicate order values with a field-level message', () => {
    const result = createRecipeSchema.safeParse({
      ...base,
      steps: [
        { order: 1, instruction: 'Boil' },
        { order: 1, instruction: 'Drain' },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Step order values must be unique');
  });

  it('still applies through patchRecipeSchema, where steps are optional', () => {
    expect(patchRecipeSchema.safeParse({}).success).toBe(true);
    expect(
      patchRecipeSchema.safeParse({
        steps: [
          { order: 3, instruction: 'a' },
          { order: 3, instruction: 'b' },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('createRecipeSchema — title must yield a usable slug', () => {
  it('accepts a title with letters, and one with only digits', () => {
    expect(createRecipeSchema.safeParse({ title: 'Pasta Carbonara' }).success).toBe(true);
    expect(createRecipeSchema.safeParse({ title: '42' }).success).toBe(true);
  });

  // slugify strips diacritics rather than dropping the characters, so these still slug fine.
  it('accepts an accented title', () => {
    expect(createRecipeSchema.safeParse({ title: 'Café Crème' }).success).toBe(true);
  });

  it.each([
    ['emoji only', '🍕🍔'],
    ['CJK only', '寿司'],
    ['punctuation only', '!!!???'],
    ['separators only', '- - -'],
  ])('rejects a %s title, which would slug to nothing usable', (_label, title) => {
    const result = createRecipeSchema.safeParse({ title });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'Title must contain at least one letter or number',
    );
  });

  // Guards the '-' case specifically: slugify collapses runs of separators, so a separators-only
  // title yields a truthy but useless '-' — an emptiness check alone would let it through.
  it('rejects a separators-only title even though its slug is non-empty', () => {
    expect(generateRecipeSlug('- - -')).toBe('-');
    expect(createRecipeSchema.safeParse({ title: '- - -' }).success).toBe(false);
  });

  it('applies on rename too — through updateRecipeSchema and patchRecipeSchema', () => {
    const body = { title: '🍕', ingredients: [], steps: [], tags: [], categories: [] };
    expect(updateRecipeSchema.safeParse(body).success).toBe(false);
    expect(patchRecipeSchema.safeParse({ title: '🍕' }).success).toBe(false);
    // A patch that never mentions the title is unaffected.
    expect(patchRecipeSchema.safeParse({ servings: 4 }).success).toBe(true);
  });
});
