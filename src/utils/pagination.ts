import { PaginationMeta } from '../types/common';

export interface PaginationQuery {
  page: number;
  limit: number;
}

export function parsePaginationQuery(query: Record<string, unknown>): PaginationQuery {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(query.limit ?? '20'), 10) || 20;
  const limit = Math.min(50, Math.max(1, rawLimit));
  return { page, limit };
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export function toSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}
