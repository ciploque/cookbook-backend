import { describe, it, expect } from 'vitest';
import { categoryDefinitionSchema } from '../../../src/modules/categories/category.schema';
import { categoryDefinitions } from '../../../src/modules/categories/categories.config';

describe('categoryDefinitionSchema', () => {
  it('accepts a well-formed definition', () => {
    expect(categoryDefinitionSchema.parse({ name: 'Main Courses', slug: 'main-courses' })).toEqual({
      name: 'Main Courses',
      slug: 'main-courses',
    });
  });

  it('rejects a slug that is not URL-safe', () => {
    for (const slug of ['Main Courses', 'main_courses', 'main/courses', 'Café']) {
      expect(categoryDefinitionSchema.safeParse({ name: 'X', slug }).success).toBe(false);
    }
  });

  it('rejects an empty name/slug and enforces the length caps', () => {
    expect(categoryDefinitionSchema.safeParse({ name: '', slug: 'x' }).success).toBe(false);
    expect(categoryDefinitionSchema.safeParse({ name: 'X', slug: '' }).success).toBe(false);
    expect(categoryDefinitionSchema.safeParse({ name: 'x'.repeat(61), slug: 'x' }).success).toBe(
      false,
    );
    expect(categoryDefinitionSchema.safeParse({ name: 'X', slug: 'x'.repeat(61) }).success).toBe(
      false,
    );
  });
});

// The checked-in registry is the source of truth and is applied by a script that runs outside
// any request — so it gets validated here, the same way shelves.config.ts is.
describe('categories.config.ts', () => {
  it('every definition is structurally valid', () => {
    for (const definition of categoryDefinitions) {
      const result = categoryDefinitionSchema.safeParse(definition);
      expect(result.success, `invalid definition: ${JSON.stringify(definition)}`).toBe(true);
    }
  });

  it('has unique slugs and unique names', () => {
    const slugs = categoryDefinitions.map((c) => c.slug);
    const names = categoryDefinitions.map((c) => c.name);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('contains the categories referenced by shelves.config.ts', () => {
    // `top-drinks` filters on category 'drinks'; without the slug in the registry no recipe
    // can carry it, and that shelf resolves to an empty row.
    expect(categoryDefinitions.map((c) => c.slug)).toContain('drinks');
  });
});
