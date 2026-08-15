import { describe, it, expect } from 'vitest';

import {
  createRecipeReportSchema,
  recipeReportParamsSchema,
  recipeReportTopicValues,
  reportQuerySchema,
} from '../../../src/modules/reports/report.schema';

describe('createRecipeReportSchema', () => {
  it('accepts every recipe report topic', () => {
    for (const topic of recipeReportTopicValues) {
      const result = createRecipeReportSchema.safeParse({ topic });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a topic outside the recipe list', () => {
    const result = createRecipeReportSchema.safeParse({ topic: 'nonsense' });
    expect(result.success).toBe(false);
  });

  it('requires a topic', () => {
    const result = createRecipeReportSchema.safeParse({ message: 'no topic given' });
    expect(result.success).toBe(false);
  });

  it('treats message as optional', () => {
    const result = createRecipeReportSchema.parse({ topic: 'spam' });
    expect(result.message).toBeUndefined();
  });

  it('rejects a message longer than 2000 chars', () => {
    const result = createRecipeReportSchema.safeParse({
      topic: 'spam',
      message: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown keys such as a client-supplied status', () => {
    const result = createRecipeReportSchema.parse({ topic: 'spam', status: 'dismissed' });
    expect(result).not.toHaveProperty('status');
  });
});

describe('recipeReportParamsSchema', () => {
  it('accepts a uuid recipeId', () => {
    const result = recipeReportParamsSchema.safeParse({
      recipeId: '0195f0a0-0000-7000-8000-000000000000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid recipeId', () => {
    const result = recipeReportParamsSchema.safeParse({ recipeId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });
});

describe('reportQuerySchema', () => {
  it('defaults page to 1 and limit to 20', () => {
    const result = reportQuerySchema.parse({});
    expect(result).toMatchObject({ page: 1, limit: 20 });
  });

  it('coerces string query values to numbers', () => {
    const result = reportQuerySchema.parse({ page: '3', limit: '15' });
    expect(result).toMatchObject({ page: 3, limit: 15 });
  });

  it('rejects a limit above 50', () => {
    const result = reportQuerySchema.safeParse({ limit: 51 });
    expect(result.success).toBe(false);
  });

  it('rejects a page below 1', () => {
    const result = reportQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });
});
