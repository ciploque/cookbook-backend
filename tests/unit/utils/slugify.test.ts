import { describe, it, expect } from 'vitest';
import { slugify, generateRecipeSlug } from '../../../src/utils/slugify';

describe('slugify()', () => {
  it('lowercases text', () => {
    expect(slugify('Pasta Carbonara')).toBe('pasta-carbonara');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world');
  });

  it('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });

  it('removes diacritics (accented characters)', () => {
    expect(slugify('Frango à Parmegiana')).toBe('frango-a-parmegiana');
    expect(slugify('Jalapeño')).toBe('jalapeno');
  });

  it('removes special characters', () => {
    expect(slugify('Hello! World & Co.')).toBe('hello-world-co');
  });

  it('trims leading and trailing spaces', () => {
    expect(slugify('  pasta  ')).toBe('pasta');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('handles numbers', () => {
    expect(slugify('Recipe 42')).toBe('recipe-42');
  });
});

describe('generateRecipeSlug()', () => {
  it('returns the slugified title', () => {
    const slug = generateRecipeSlug('Pasta Carbonara');
    expect(slug).toBe('pasta-carbonara');
  });

  it('produces the same slug on successive calls for the same title', () => {
    const slug1 = generateRecipeSlug('Same Title');
    const slug2 = generateRecipeSlug('Same Title');
    expect(slug1).toBe('same-title');
    expect(slug2).toBe('same-title');
  });
});
