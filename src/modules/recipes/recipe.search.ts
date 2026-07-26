import { meiliClient, RECIPES_INDEX } from '../../config/meilisearch';
import { buildMeta } from '../../utils/pagination';
import { RecipeQuery } from './recipe.schema';

export interface RecipeSearchDocument {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  imageUrls: string[];
  prepTimeMinutes: number | null;
  difficulty: number | null;
  authorId: string;
  author: { id: string; username: string; displayName: string };
  tags: string[];
  averageRating: number | null;
  reviewCount: number;
  createdAt: string;
}

// These are fire-and-forget: the returned promise chain is intentionally not awaited or
// returned, so the function itself never needs to be async — callers use `void indexRecipe(...)`
// and never observe completion.
export function indexRecipe(doc: RecipeSearchDocument): void {
  meiliClient
    .index(RECIPES_INDEX)
    .addDocuments([doc])
    .catch((err: unknown) => console.error('[meilisearch] indexRecipe failed:', err));
}

export function updateIndexedRecipe(doc: RecipeSearchDocument): void {
  meiliClient
    .index(RECIPES_INDEX)
    .updateDocuments([doc])
    .catch((err: unknown) => console.error('[meilisearch] updateIndexedRecipe failed:', err));
}

export function updateIndexedRecipeRating(
  recipeId: string,
  averageRating: number | null,
  reviewCount: number,
): void {
  meiliClient
    .index(RECIPES_INDEX)
    .updateDocuments([{ id: recipeId, averageRating, reviewCount }])
    .catch((err: unknown) => console.error('[meilisearch] updateIndexedRecipeRating failed:', err));
}

export function deleteIndexedRecipe(recipeId: string): void {
  meiliClient
    .index(RECIPES_INDEX)
    .deleteDocument(recipeId)
    .catch((err: unknown) => console.error('[meilisearch] deleteIndexedRecipe failed:', err));
}

function escapeMeiliString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function searchRecipesViaMeili(query: RecipeQuery) {
  const { q, tags, category, authorId, minRating, page, limit, sortBy, order } = query;

  const tagSlugs = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const filter: string[] = [];
  if (category) filter.push(`category = "${escapeMeiliString(category)}"`);
  if (authorId) filter.push(`authorId = "${escapeMeiliString(authorId)}"`);
  if (minRating !== undefined) filter.push(`averageRating >= ${minRating}`);
  tagSlugs.forEach((slug) => filter.push(`tags = "${escapeMeiliString(slug)}"`));

  // Page-based pagination (page/hitsPerPage) makes Meilisearch compute an exact totalHits,
  // unlike offset/limit which only ever returns an estimatedTotalHits.
  const searchParams = {
    filter: filter.length > 0 ? filter : undefined,
    sort: [`${sortBy}:${order}`],
    page,
    hitsPerPage: limit,
  };
  const result = await meiliClient
    .index(RECIPES_INDEX)
    .search<RecipeSearchDocument, typeof searchParams>(q, searchParams);

  return {
    data: result.hits.map((hit) => ({
      ...hit,
      description: (hit.description ?? '').slice(0, 200),
    })),
    meta: buildMeta(page, limit, result.totalHits ?? 0),
  };
}
