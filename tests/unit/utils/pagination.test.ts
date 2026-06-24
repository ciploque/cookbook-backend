import { describe, it, expect } from 'vitest';
import { parsePaginationQuery, buildMeta, toSkip } from '../../../src/utils/pagination';

describe('parsePaginationQuery()', () => {
  it('returns defaults when no params provided', () => {
    expect(parsePaginationQuery({})).toEqual({ page: 1, limit: 20 });
  });

  it('parses valid page and limit', () => {
    expect(parsePaginationQuery({ page: '3', limit: '10' })).toEqual({ page: 3, limit: 10 });
  });

  it('clamps page to minimum of 1', () => {
    expect(parsePaginationQuery({ page: '0' })).toEqual({ page: 1, limit: 20 });
    expect(parsePaginationQuery({ page: '-5' })).toEqual({ page: 1, limit: 20 });
  });

  it('clamps limit to maximum of 50', () => {
    expect(parsePaginationQuery({ limit: '100' })).toEqual({ page: 1, limit: 50 });
  });

  it('falls back to default limit of 20 when limit is 0 (falsy parse result)', () => {
    // parseInt('0') === 0, which is falsy, so || 20 kicks in before Math.max clamp
    expect(parsePaginationQuery({ limit: '0' })).toEqual({ page: 1, limit: 20 });
  });

  it('falls back to defaults on non-numeric input', () => {
    expect(parsePaginationQuery({ page: 'abc', limit: 'xyz' })).toEqual({ page: 1, limit: 20 });
  });
});

describe('buildMeta()', () => {
  it('computes totalPages correctly', () => {
    const meta = buildMeta(1, 20, 45);
    expect(meta.totalPages).toBe(3);
  });

  it('sets hasNextPage when more pages remain', () => {
    const meta = buildMeta(1, 20, 45);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPrevPage).toBe(false);
  });

  it('sets hasPrevPage on pages after the first', () => {
    const meta = buildMeta(2, 20, 45);
    expect(meta.hasPrevPage).toBe(true);
    expect(meta.hasNextPage).toBe(true);
  });

  it('sets neither flag on the only page', () => {
    const meta = buildMeta(1, 20, 10);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(false);
  });

  it('reflects exact totals when total is zero', () => {
    const meta = buildMeta(1, 20, 0);
    expect(meta.total).toBe(0);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
  });

  it('returns all provided values in output', () => {
    const meta = buildMeta(2, 10, 25);
    expect(meta).toMatchObject({ page: 2, limit: 10, total: 25 });
  });
});

describe('toSkip()', () => {
  it('returns 0 for page 1', () => {
    expect(toSkip(1, 20)).toBe(0);
  });

  it('returns correct offset for subsequent pages', () => {
    expect(toSkip(2, 20)).toBe(20);
    expect(toSkip(3, 10)).toBe(20);
  });
});
