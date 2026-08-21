import { prisma } from '../../../config/database';
import { ManualCriteria, manualCriteriaSchema } from '../shelf.schema';
import { ShelfResolver } from './types';

/**
 * The editorial escape hatch: an explicit, hand-ordered list of recipes.
 *
 * Exists so a row that no query can express (a seasonal hand-pick, a sponsor placement)
 * doesn't require inventing a tag for it. Ids that no longer resolve are dropped rather than
 * failing the refresh — a recipe deleted after the config was written must not break the shelf.
 */
export const manualResolver: ShelfResolver<ManualCriteria> = {
  source: 'manual',
  criteriaSchema: manualCriteriaSchema,

  async resolve(criteria, maxItems) {
    const ids = criteria.recipeIds.slice(0, maxItems);
    if (ids.length === 0) return [];

    const existing = await prisma.recipe.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    const alive = new Set(existing.map((r) => r.id));

    // Filter, don't re-sort: the author's ordering is the whole point of this resolver.
    return ids.filter((id) => alive.has(id));
  },
};
