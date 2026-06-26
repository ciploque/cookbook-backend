import { meiliClient, RECIPES_INDEX } from '../../config/meilisearch';
import { buildMeta, toSkip } from '../../utils/pagination';
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
  createdAt: string;
}

export async function indexRecipe(doc: RecipeSearchDocument): Promise<void> {
  meiliClient
    .index(RECIPES_INDEX)
    .addDocuments([doc])
    .catch((err: unknown) => console.error('[meilisearch] indexRecipe failed:', err));
}

export async function updateIndexedRecipe(doc: RecipeSearchDocument): Promise<void> {
  meiliClient
    .index(RECIPES_INDEX)
    .updateDocuments([doc])
    .catch((err: unknown) => console.error('[meilisearch] updateIndexedRecipe failed:', err));
}

export async function deleteIndexedRecipe(recipeId: string): Promise<void> {
  meiliClient
    .index(RECIPES_INDEX)
    .deleteDocument(recipeId)
    .catch((err: unknown) => console.error('[meilisearch] deleteIndexedRecipe failed:', err));
}

export async function searchRecipesViaMeili(query: RecipeQuery) {
  const { q, tags, category, authorId, page, limit, sortBy, order } = query;

  const tagSlugs = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [];

  const filter: string[] = [];
  if (category) filter.push(`category = "${category}"`);
  if (authorId) filter.push(`authorId = "${authorId}"`);
  tagSlugs.forEach((slug) => filter.push(`tags = "${slug}"`));

  const result = await meiliClient.index(RECIPES_INDEX).search<RecipeSearchDocument>(q, {
    filter: filter.length > 0 ? filter : undefined,
    sort: [`${sortBy}:${order}`],
    offset: toSkip(page, limit),
    limit,
  });

  return {
    data: result.hits.map((hit: any) => ({
      ...hit,
      description: (hit.description ?? '').slice(0, 200),
    })),
    meta: buildMeta(page, limit, result.estimatedTotalHits ?? 0),
  };
}
