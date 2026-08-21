import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/database';
import { TrendingCriteria, trendingCriteriaSchema } from '../shelf.schema';
import { ShelfResolver } from './types';

/**
 * Time-windowed popularity — the thing `averageRating` (all-time) cannot express.
 *
 * Ranks by how many reviews a recipe received inside the window, via `Review.createdAt` and
 * the existing `@@index([recipeId])`. Deliberately built on data that already exists: no
 * view counter, no rollup table, no migration. If a denser signal is wanted later it becomes
 * a *different* resolver, leaving this one and every shelf using it untouched.
 */
export const trendingResolver: ShelfResolver<TrendingCriteria> = {
  source: 'trending',
  criteriaSchema: trendingCriteriaSchema,

  async resolve(criteria, maxItems) {
    const since = new Date(Date.now() - criteria.windowDays * 24 * 60 * 60 * 1000);

    const tagSlugs = criteria.tags
      ? criteria.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    // Same AND-of-tags semantics as listRecipes, applied to the review's recipe relation.
    const recipeFilter: Prisma.RecipeWhereInput = {
      ...(criteria.category && { category: criteria.category }),
      ...(tagSlugs.length > 0 && {
        AND: tagSlugs.map((slug) => ({ recipeTags: { some: { tag: { slug } } } })),
      }),
    };
    const hasRecipeFilter = criteria.category !== undefined || tagSlugs.length > 0;

    const grouped = await prisma.review.groupBy({
      by: ['recipeId'],
      where: {
        createdAt: { gte: since },
        ...(hasRecipeFilter && { recipe: recipeFilter }),
      },
      _count: { recipeId: true },
      orderBy: { _count: { recipeId: 'desc' } },
      take: maxItems,
    });

    return grouped.map((row) => row.recipeId);
  },
};
