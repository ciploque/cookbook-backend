import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import { createRecipeSchema, recipeQuerySchema } from '../../../src/modules/recipes/recipe.schema';

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
    const result = createRecipeSchema.safeParse({ ...base, videoUrl: 'https://evil.com/video.mp4' });
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
