import { listRecipes } from '../../recipes/recipe.service';
import { recipeQuerySchema } from '../../recipes/recipe.schema';
import { QueryCriteria, queryCriteriaSchema } from '../shelf.schema';
import { ShelfResolver } from './types';

/**
 * The workhorse resolver: a shelf is a saved `GET /recipes` query.
 *
 * Delegating to `listRecipes` rather than re-implementing the filters means a shelf inherits
 * tag AND-ing, category equality, minRating, sorting *and* Meilisearch free-text routing for
 * free, and can never drift from what the public listing endpoint does.
 */
export const queryResolver: ShelfResolver<QueryCriteria> = {
  source: 'query',
  criteriaSchema: queryCriteriaSchema,

  async resolve(criteria, maxItems) {
    // Re-parse through the full recipe query schema so sortBy/order/page/limit defaults are
    // applied exactly as they are for a real HTTP request.
    const query = recipeQuerySchema.parse({ ...criteria, page: 1, limit: maxItems });
    const { data } = await listRecipes(query);
    return data.map((recipe) => recipe.id);
  },
};
