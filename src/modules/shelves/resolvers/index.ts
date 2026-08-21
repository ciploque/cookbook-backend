import { ApiError } from '../../../utils/ApiError';
import { manualResolver } from './manual.resolver';
import { queryResolver } from './query.resolver';
import { trendingResolver } from './trending.resolver';
import { ShelfResolver } from './types';

/**
 * The resolver registry — the mechanism that interprets a shelf's criteria.
 *
 * To add a new kind of themed row: write `resolvers/<name>.resolver.ts`, add it here, and add
 * its name to `shelfSourceValues` in shelf.schema.ts. No migration, no API change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Record<string, ShelfResolver<any>> = {
  [queryResolver.source]: queryResolver,
  [manualResolver.source]: manualResolver,
  [trendingResolver.source]: trendingResolver,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getResolver(source: string): ShelfResolver<any> {
  const resolver = registry[source];
  if (!resolver) {
    throw ApiError.internal(
      `Unknown shelf source "${source}". Known sources: ${Object.keys(registry).join(', ')}`,
    );
  }
  return resolver;
}

/**
 * Validates a raw `criteria` payload against the resolver named by `source`.
 * Used both at sync time (fail fast on a bad config entry) and on refresh (the JSON column
 * is untyped, so a hand-edited row could hold anything).
 */
export function parseCriteria(source: string, criteria: unknown): unknown {
  const resolver = getResolver(source);
  const result = resolver.criteriaSchema.safeParse(criteria);
  if (!result.success) {
    throw ApiError.validation(result.error.flatten());
  }
  return result.data;
}

/** Resolves a shelf's criteria into an ordered list of recipe ids. */
export async function resolveShelfItems(
  source: string,
  criteria: unknown,
  maxItems: number,
): Promise<string[]> {
  const resolver = getResolver(source);
  return resolver.resolve(parseCriteria(source, criteria), maxItems);
}

export { ShelfResolver };
