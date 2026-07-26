import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import { createRecipeSchema, recipeQuerySchema } from '../../../src/modules/recipes/recipe.schema';

describe('createRecipeSchema — category normalization', () => {
  const base = { title: 'Test', tags: [], ingredients: [], steps: [] };

  it('lowercases and trims category on write', () => {
    const result = createRecipeSchema.parse({ ...base, category: '  Pasta  ' });
    expect(result.category).toBe('pasta');
  });

  it('leaves an already-lowercase category untouched', () => {
    const result = createRecipeSchema.parse({ ...base, category: 'outros' });
    expect(result.category).toBe('outros');
  });
});

describe('recipeQuerySchema — category normalization', () => {
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
