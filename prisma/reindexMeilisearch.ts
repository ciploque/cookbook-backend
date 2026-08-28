import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import { env } from '../src/config/env';
import { RECIPES_INDEX } from '../src/config/meilisearch';
import { RecipeSearchDocument } from '../src/modules/recipes/recipe.search';

const prisma = new PrismaClient();
const meili = new MeiliSearch({ host: env.MEILISEARCH_URL, apiKey: env.MEILISEARCH_API_KEY });

async function main() {
  const recipes = await prisma.recipe.findMany({
    include: {
      author: { select: { id: true, username: true, displayName: true } },
      recipeTags: { include: { tag: true } },
      recipeCategories: { include: { category: true } },
    },
  });

  const docs: RecipeSearchDocument[] = recipes.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? null,
    authorNote: r.authorNote ?? null,
    categories: r.recipeCategories.map((rc) => rc.category.slug),
    coverImageUrl: r.coverImageUrl,
    imageUrls: r.imageUrls,
    videoUrl: r.videoUrl,
    prepTimeMinutes: r.prepTimeMinutes,
    difficulty: r.difficulty ?? null,
    authorId: r.authorId,
    author: { id: r.author.id, username: r.author.username, displayName: r.author.displayName },
    tags: r.recipeTags.map((rt) => rt.tag.slug),
    averageRating: r.averageRating,
    reviewCount: r.reviewCount,
    createdAt: r.createdAt.toISOString(),
  }));

  if (docs.length === 0) {
    console.log('No recipes found — nothing to index.');
    return;
  }

  const task = await meili.index(RECIPES_INDEX).addDocuments(docs, { primaryKey: 'id' });
  console.log(`Enqueued reindex of ${docs.length} recipe(s). Task uid: ${task.taskUid}`);
}

main()
  .catch((err) => {
    console.error('Reindex failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
