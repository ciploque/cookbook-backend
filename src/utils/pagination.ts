import { PaginationMeta } from '../types/common';

export interface PaginationQuery {
  page: number;
  limit: number;
}

// query values come in as `unknown` (Express can parse `?page[x]=1` into a nested object) —
// only ever String()-convert values already known to be string|number, never a bare object.
function parseIntOrDefault(value: unknown, fallback: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  return parseInt(String(value), 10) || fallback;
}

export function parsePaginationQuery(query: Record<string, unknown>): PaginationQuery {
  const page = Math.max(1, parseIntOrDefault(query.page, 1));
  const rawLimit = parseIntOrDefault(query.limit, 20);
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
