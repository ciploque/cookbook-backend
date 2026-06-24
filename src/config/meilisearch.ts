import { MeiliSearch } from 'meilisearch';
import { env } from './env';

export const meiliClient = new MeiliSearch({
  host: env.MEILISEARCH_URL,
  apiKey: env.MEILISEARCH_API_KEY,
});

export const RECIPES_INDEX = 'recipes';
