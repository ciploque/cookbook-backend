import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import {
  createReviewSchema,
  reviewQuerySchema,
  updateReviewSchema,
} from '../../../src/modules/reviews/review.schema';

describe('createReviewSchema', () => {
  it('parses a body without imageUrls', () => {
    const result = createReviewSchema.safeParse({
      recipeId: '123e4567-e89b-12d3-a456-426614174000',
      rating: 4,
    });
    expect(result.success).toBe(true);
  });

  it('strips an imageUrls field if passed — the schema no longer defines it', () => {
    const result = createReviewSchema.parse({
      recipeId: '123e4567-e89b-12d3-a456-426614174000',
      rating: 4,
      imageUrls: ['https://example.com/a.jpg'],
    });
    expect(result).not.toHaveProperty('imageUrls');
  });
});

describe('updateReviewSchema', () => {
  it('parses a rating with content', () => {
    const result = updateReviewSchema.safeParse({ rating: 5, content: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('parses a rating alone — content is optional', () => {
    const result = updateReviewSchema.parse({ rating: 5 });
    expect(result.content).toBeUndefined();
  });

  it('requires rating — PUT is a full replace, not a partial update', () => {
    const result = updateReviewSchema.safeParse({ content: 'Updated' });
    expect(result.success).toBe(false);
  });

  it('rejects a rating outside 1–5 or a non-integer', () => {
    expect(updateReviewSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(updateReviewSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(updateReviewSchema.safeParse({ rating: 4.5 }).success).toBe(false);
  });

  it('rejects content longer than 2000 chars', () => {
    const result = updateReviewSchema.safeParse({ rating: 4, content: 'x'.repeat(2001) });
    expect(result.success).toBe(false);
  });

  it('strips recipeId and imageUrls — neither is updatable through this body', () => {
    const result = updateReviewSchema.parse({
      rating: 4,
      recipeId: '123e4567-e89b-12d3-a456-426614174000',
      imageUrls: ['https://example.com/a.jpg'],
    });
    expect(result).not.toHaveProperty('recipeId');
    expect(result).not.toHaveProperty('imageUrls');
  });
});

describe('reviewQuerySchema — filter', () => {
  it('accepts each rating:N value', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const result = reviewQuerySchema.safeParse({ filter: `rating:${n}` });
      expect(result.success).toBe(true);
    }
  });

  it('accepts the media value', () => {
    const result = reviewQuerySchema.safeParse({ filter: 'media' });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range rating', () => {
    const result = reviewQuerySchema.safeParse({ filter: 'rating:6' });
    expect(result.success).toBe(false);
  });

  it('rejects an arbitrary string', () => {
    const result = reviewQuerySchema.safeParse({ filter: 'foo' });
    expect(result.success).toBe(false);
  });

  it('is optional — omitting it still parses', () => {
    const result = reviewQuerySchema.parse({});
    expect(result.filter).toBeUndefined();
  });
});

describe('reviewQuerySchema — order', () => {
  it('defaults to newest when omitted', () => {
    const result = reviewQuerySchema.parse({});
    expect(result.order).toBe('newest');
  });

  it('accepts rating_asc and rating_desc', () => {
    expect(reviewQuerySchema.safeParse({ order: 'rating_asc' }).success).toBe(true);
    expect(reviewQuerySchema.safeParse({ order: 'rating_desc' }).success).toBe(true);
  });

  it('rejects an invalid order value', () => {
    const result = reviewQuerySchema.safeParse({ order: 'oldest' });
    expect(result.success).toBe(false);
  });
});
