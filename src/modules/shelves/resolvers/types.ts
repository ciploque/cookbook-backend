import { ZodType, ZodTypeDef } from 'zod';

/**
 * A shelf resolver turns a shelf's stored `criteria` into an ordered list of recipe ids.
 *
 * This is the extension point for new kinds of themed rows: implement one of these, register
 * it in `resolvers/index.ts`, and add its name to `shelfSourceValues`. Nothing else changes —
 * not the `shelves` table (criteria is JSON), not the refresh job, not the serving path,
 * not the API contract.
 */
export interface ShelfResolver<C> {
  /** Matches `Shelf.source`. */
  source: string;
  /**
   * Validates the JSON `criteria` column for this source. Applied at sync time and on refresh.
   * Input is `unknown` because criteria arrives from a JSON column (or a hand-edited config),
   * never as an already-typed object — which also lets a schema use `.default()`.
   */
  criteriaSchema: ZodType<C, ZodTypeDef, unknown>;
  /** Returns recipe ids in the order they should appear, at most `maxItems` of them. */
  resolve(criteria: C, maxItems: number): Promise<string[]>;
}
