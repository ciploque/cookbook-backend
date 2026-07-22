import { meiliClient, RECIPES_INDEX } from './meilisearch';

export async function setupMeilisearch(): Promise<void> {
  const index = meiliClient.index(RECIPES_INDEX);
  await index.updateSearchableAttributes(['title', 'description', 'category', 'tags']);
  await index.updateFilterableAttributes(['category', 'authorId', 'tags', 'averageRating']);
  await index.updateSortableAttributes(['createdAt', 'updatedAt', 'title', 'averageRating']);
}
