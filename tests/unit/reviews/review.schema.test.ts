import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/env', () => ({
  trustedImageDomains: [] as string[],
}));

import { reviewQuerySchema } from '../../../src/modules/reviews/review.schema';

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
