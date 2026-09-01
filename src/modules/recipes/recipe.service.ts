import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { generateRecipeSlug } from '../../utils/slugify';
import { upsertTags } from '../tags/tag.service';
import { resolveCategories } from '../categories/category.service';
import { deleteImage, storeImage } from '../storage/storage.service';
import {
  CreateRecipeInput,
  PatchRecipeInput,
  RecipeQuery,
  UpdateRecipeInput,
} from './recipe.schema';
import {
  RecipeSearchDocument,
  deleteIndexedRecipe,
  indexRecipe,
  searchRecipesViaMeili,
  updateIndexedRecipe,
} from './recipe.search';

const MAX_GALLERY_IMAGES = 10;

// Recipe writes can violate two different unique constraints: @@unique([authorId, slug]) on the
// recipe itself, and @@unique([recipeId, order]) on the steps created in the same transaction.
// Only the first is a title conflict, so the target is inspected rather than blanket-mapped —
// otherwise a duplicate step order would surface as "you already have a recipe with this title".
// `meta.target` is a string[] of field names on some Prisma/connector combinations and the raw
// constraint name ('recipes_authorId_slug_key') on others; stringifying covers both.
function rethrowSlugConflict(err: unknown): never {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    String(err.meta?.target).includes('slug')
  ) {
    throw ApiError.conflict('You already have a recipe with this title');
  }
  throw err;
}

const recipeFullInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  ingredients: { orderBy: { order: 'asc' as const } },
  steps: { orderBy: { order: 'asc' as const } },
  recipeTags: { include: { tag: true } },
  recipeCategories: { include: { category: true } },
} satisfies Prisma.RecipeInclude;

function formatRecipeFull(recipe: Prisma.RecipeGetPayload<{ include: typeof recipeFullInclude }>) {
  const { recipeTags, recipeCategories, ...rest } = recipe;
  return {
    ...rest,
    tags: recipeTags.map((rt) => rt.tag.slug),
    categories: recipeCategories.map((rc) => rc.category.slug),
  };
}

const NO_VIEWER_STATE = { hasReviewed: false, isSavedInCollection: false };

// Viewer-scoped flags for the recipe detail reads. Both lookups filter through a relation on
// authProviderId, so the caller's User row never has to be resolved separately. Skipped
// entirely for an anonymous caller — who has reviewed and saved nothing by definition.
// Deliberately not folded into recipeFullInclude: a conditional include breaks the
// RecipeGetPayload typing for every other caller, and toSearchDocument must never pick these
// up — the Meilisearch document is shared across all viewers.
async function resolveViewerState(recipeId: string, viewerSub?: string) {
  if (!viewerSub) return NO_VIEWER_STATE;

  const [review, saved] = await Promise.all([
    prisma.review.findFirst({
      where: { recipeId, author: { authProviderId: viewerSub } },
      select: { id: true },
    }),
    prisma.collectionRecipe.findFirst({
      where: { recipeId, collection: { owner: { authProviderId: viewerSub } } },
      select: { recipeId: true },
    }),
  ]);

  return { hasReviewed: review !== null, isSavedInCollection: saved !== null };
}

// Batched counterpart of resolveViewerState's saved-check, for list pages (up to `limit`, capped
// at 50, items per request) — one findMany instead of N findFirsts. No query at all for an
// anonymous caller or an empty page. Deliberately does not resolve hasReviewed: list items don't
// carry it, only the two detail routes do.
async function attachSavedState<T extends { id: string }>(
  items: T[],
  viewerSub?: string,
): Promise<(T & { isSavedInCollection: boolean })[]> {
  if (!viewerSub || items.length === 0) {
    return items.map((item) => ({ ...item, isSavedInCollection: false }));
  }

  const saved = await prisma.collectionRecipe.findMany({
    where: {
      recipeId: { in: items.map((item) => item.id) },
      collection: { owner: { authProviderId: viewerSub } },
    },
    select: { recipeId: true },
    distinct: ['recipeId'],
  });
  const savedIds = new Set(saved.map((s) => s.recipeId));

  return items.map((item) => ({ ...item, isSavedInCollection: savedIds.has(item.id) }));
}

function toSearchDocument(recipe: ReturnType<typeof formatRecipeFull>): RecipeSearchDocument {
  return {
    id: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    description: recipe.description ?? null,
    authorNote: recipe.authorNote ?? null,
    categories: recipe.categories,
    coverImageUrl: recipe.coverImageUrl,
    imageUrls: recipe.imageUrls,
    videoUrl: recipe.videoUrl,
    prepTimeMinutes: recipe.prepTimeMinutes,
    difficulty: recipe.difficulty ?? null,
    authorId: recipe.authorId,
    author: {
      id: recipe.author.id,
      username: recipe.author.username,
      displayName: recipe.author.displayName,
    },
    tags: recipe.tags,
    averageRating: recipe.averageRating,
    reviewCount: recipe.reviewCount,
    createdAt: recipe.createdAt.toISOString(),
  };
}

// Exported as this module's public list-item contract: the shelves module renders the same
// abbreviated recipe shape, and so do the three single-collection GETs — duplicating the
// select/mapper in either place would let them drift.
export const recipeListSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  authorNote: true,
  coverImageUrl: true,
  imageUrls: true,
  videoUrl: true,
  prepTimeMinutes: true,
  difficulty: true,
  averageRating: true,
  reviewCount: true,
  createdAt: true,
  author: { select: { id: true, username: true, displayName: true } },
  recipeTags: { include: { tag: true } },
  recipeCategories: { include: { category: true } },
} satisfies Prisma.RecipeSelect;

export function formatRecipeListItem(
  recipe: Prisma.RecipeGetPayload<{ select: typeof recipeListSelect }>,
) {
  const { recipeTags, recipeCategories, description, ...rest } = recipe;
  return {
    ...rest,
    description: (description ?? '').slice(0, 200),
    tags: recipeTags.map((rt) => rt.tag.slug),
    categories: recipeCategories.map((rc) => rc.category.slug),
  };
}

async function listRecipesFromPostgres(query: RecipeQuery) {
  const { tags, category, authorId, minRating, page, limit, sortBy, order } = query;
  const skip = toSkip(page, limit);

  const tagSlugs = tags
    ? tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const where: Prisma.RecipeWhereInput = {
    // A single slug matched through the join table: the recipe carries that category among
    // its own. `Category.slug` is unique, so the lookup is index-backed.
    ...(category && { recipeCategories: { some: { category: { slug: category } } } }),
    ...(authorId && { authorId }),
    ...(minRating !== undefined && { averageRating: { gte: minRating } }),
    ...(tagSlugs.length > 0 && {
      AND: tagSlugs.map((slug) => ({
        recipeTags: { some: { tag: { slug } } },
      })),
    }),
  };

  const [total, recipes] = await Promise.all([
    prisma.recipe.count({ where }),
    prisma.recipe.findMany({
      where,
      select: recipeListSelect,
      orderBy: { [sortBy]: order },
      skip,
      take: limit,
    }),
  ]);

  return {
    data: recipes.map(formatRecipeListItem),
    meta: buildMeta(page, limit, total),
  };
}

// Both branches funnel through the same attachSavedState helper, so the saved-state logic
// itself can't drift between the Postgres and Meilisearch paths — only the item shapes differ,
// which is why this isn't a single shared call site.
export async function listRecipes(query: RecipeQuery, viewerSub?: string) {
  if (query.q) {
    const result = await searchRecipesViaMeili(query);
    return { data: await attachSavedState(result.data, viewerSub), meta: result.meta };
  }

  const result = await listRecipesFromPostgres(query);
  return { data: await attachSavedState(result.data, viewerSub), meta: result.meta };
}

export async function getRecipeByUsernameAndSlug(
  username: string,
  slug: string,
  viewerSub?: string,
) {
  const recipe = await prisma.recipe.findFirst({
    where: { slug, author: { username } },
    include: recipeFullInclude,
  });
  if (!recipe) throw ApiError.notFound('Recipe');
  return { ...formatRecipeFull(recipe), ...(await resolveViewerState(recipe.id, viewerSub)) };
}

export async function getRecipeById(id: string, viewerSub?: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: recipeFullInclude,
  });
  if (!recipe) throw ApiError.notFound('Recipe');
  return { ...formatRecipeFull(recipe), ...(await resolveViewerState(recipe.id, viewerSub)) };
}

export async function getRecipeAuthorId(recipeId: string): Promise<string | null> {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { author: { select: { authProviderId: true } } },
  });
  return recipe?.author.authProviderId ?? null;
}

export async function createRecipe(authProviderId: string, input: CreateRecipeInput) {
  const author = await prisma.user.findUnique({ where: { authProviderId } });
  if (!author) throw ApiError.notFound('User');

  const slug = generateRecipeSlug(input.title);
  const tags = await upsertTags(input.tags);
  // Resolved before the write: an unknown slug throws a 422 here, leaving nothing behind.
  const categories = await resolveCategories(input.categories);

  let recipe;
  try {
    recipe = await prisma.recipe.create({
      data: {
        slug,
        title: input.title,
        description: input.description,
        authorNote: input.authorNote,
        coverImageUrl: null,
        imageUrls: [],
        videoUrl: input.videoUrl,
        prepTimeMinutes: input.prepTimeMinutes,
        servings: input.servings,
        difficulty: input.difficulty,
        authorId: author.id,
        ingredients: {
          create: input.ingredients.map((ing, i) => ({ ...ing, order: i })),
        },
        steps: {
          create: input.steps,
        },
        recipeTags: {
          create: tags.map((t) => ({ tagId: t.id })),
        },
        recipeCategories: {
          create: categories.map((c) => ({ categoryId: c.id })),
        },
      },
      include: recipeFullInclude,
    });
  } catch (e) {
    rethrowSlugConflict(e);
  }

  const formatted = formatRecipeFull(recipe);
  void indexRecipe(toSearchDocument(formatted));
  return formatted;
}

// The slug tracks the title: `title` is required on PUT, so every full update re-derives it and
// the recipe's pretty URL always matches the title on the page. See the `Recipe.slug` bullet under
// "Schema decisions" in CLAUDE.md for why that's preferred over freezing it at creation.
export async function updateRecipe(recipeId: string, input: UpdateRecipeInput) {
  const tags = await upsertTags(input.tags);
  const categories = await resolveCategories(input.categories);

  let recipe;
  try {
    recipe = await prisma.$transaction(async (tx) => {
      await tx.recipeIngredient.deleteMany({ where: { recipeId } });
      await tx.recipeStep.deleteMany({ where: { recipeId } });
      await tx.recipeTag.deleteMany({ where: { recipeId } });
      await tx.recipeCategory.deleteMany({ where: { recipeId } });

      return tx.recipe.update({
        where: { id: recipeId },
        data: {
          slug: generateRecipeSlug(input.title),
          title: input.title,
          description: input.description,
          authorNote: input.authorNote,
          videoUrl: input.videoUrl,
          prepTimeMinutes: input.prepTimeMinutes,
          servings: input.servings,
          difficulty: input.difficulty,
          ingredients: {
            create: input.ingredients.map((ing, i) => ({ ...ing, order: i })),
          },
          steps: {
            create: input.steps,
          },
          recipeTags: {
            create: tags.map((t) => ({ tagId: t.id })),
          },
          recipeCategories: {
            create: categories.map((c) => ({ categoryId: c.id })),
          },
        },
        include: recipeFullInclude,
      });
    });
  } catch (e) {
    // Raised by the update inside the transaction, so nothing is half-written.
    rethrowSlugConflict(e);
  }

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function patchRecipe(recipeId: string, input: PatchRecipeInput) {
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');

  const tags = input.tags !== undefined ? await upsertTags(input.tags) : undefined;
  const categories =
    input.categories !== undefined ? await resolveCategories(input.categories) : undefined;

  let recipe;
  try {
    recipe = await prisma.$transaction(async (tx) => {
      if (input.ingredients !== undefined) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId } });
      }
      if (input.steps !== undefined) {
        await tx.recipeStep.deleteMany({ where: { recipeId } });
      }
      if (tags !== undefined) {
        await tx.recipeTag.deleteMany({ where: { recipeId } });
      }
      if (categories !== undefined) {
        await tx.recipeCategory.deleteMany({ where: { recipeId } });
      }

      return tx.recipe.update({
        where: { id: recipeId },
        data: {
          // Re-slugged only when the title is actually part of the patch — a PATCH touching only
          // `servings` must not move the recipe's URL.
          ...(input.title !== undefined && {
            slug: generateRecipeSlug(input.title),
            title: input.title,
          }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.authorNote !== undefined && { authorNote: input.authorNote }),
          ...(input.videoUrl !== undefined && { videoUrl: input.videoUrl }),
          ...(input.prepTimeMinutes !== undefined && { prepTimeMinutes: input.prepTimeMinutes }),
          ...(input.servings !== undefined && { servings: input.servings }),
          ...(input.difficulty !== undefined && { difficulty: input.difficulty }),
          ...(input.ingredients !== undefined && {
            ingredients: { create: input.ingredients.map((ing, i) => ({ ...ing, order: i })) },
          }),
          ...(input.steps !== undefined && {
            steps: { create: input.steps },
          }),
          ...(tags !== undefined && {
            recipeTags: { create: tags.map((t) => ({ tagId: t.id })) },
          }),
          ...(categories !== undefined && {
            recipeCategories: { create: categories.map((c) => ({ categoryId: c.id })) },
          }),
        },
        include: recipeFullInclude,
      });
    });
  } catch (e) {
    rethrowSlugConflict(e);
  }

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');
  await prisma.recipe.delete({ where: { id: recipeId } });
  void deleteIndexedRecipe(recipeId);

  if (existing.coverImageUrl) void deleteImage(existing.coverImageUrl);
  existing.imageUrls.forEach((key) => void deleteImage(key));
}

export async function listRecipesByUser(userId: string, query: RecipeQuery, viewerSub?: string) {
  return listRecipes({ ...query, authorId: userId }, viewerSub);
}

export async function uploadCoverImage(recipeId: string, buffer: Buffer) {
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');

  const key = await storeImage(buffer, `recipes/${recipeId}/cover`);
  if (existing.coverImageUrl) void deleteImage(existing.coverImageUrl);

  const recipe = await prisma.recipe.update({
    where: { id: recipeId },
    data: { coverImageUrl: key },
    include: recipeFullInclude,
  });

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function deleteCoverImage(recipeId: string) {
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');

  if (existing.coverImageUrl) void deleteImage(existing.coverImageUrl);

  const recipe = await prisma.recipe.update({
    where: { id: recipeId },
    data: { coverImageUrl: null },
    include: recipeFullInclude,
  });

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function addGalleryImages(recipeId: string, buffers: Buffer[]) {
  const existing = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { imageUrls: true },
  });
  if (!existing) throw ApiError.notFound('Recipe');

  const capMessage = (current: number) =>
    `Maximum of ${MAX_GALLERY_IMAGES} images allowed in gallery ` +
    `(currently ${current}, tried to add ${buffers.length})`;

  // Fast path: reject an obvious over-cap before spending R2 writes.
  if (existing.imageUrls.length + buffers.length > MAX_GALLERY_IMAGES) {
    throw ApiError.validation({ images: [capMessage(existing.imageUrls.length)] });
  }

  const newKeys = await Promise.all(
    buffers.map((buffer) => storeImage(buffer, `recipes/${recipeId}/gallery`)),
  );

  // Atomic, race-safe capped append: the cap lives in the WHERE clause, so concurrent uploads
  // can neither exceed it nor lose each other's writes (unlike a read-then-update round-trip).
  const affected = await prisma.$executeRaw(Prisma.sql`
    UPDATE "recipes"
    SET "imageUrls" = "imageUrls" || ARRAY[${Prisma.join(newKeys)}]::text[]
    WHERE "id" = ${recipeId}::uuid
      AND cardinality("imageUrls") + ${newKeys.length} <= ${MAX_GALLERY_IMAGES}
  `);

  if (affected === 0) {
    // Lost the race against a concurrent upload — undo the just-stored objects to avoid orphans.
    newKeys.forEach((key) => void deleteImage(key));
    throw ApiError.validation({ images: [capMessage(MAX_GALLERY_IMAGES)] });
  }

  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: recipeFullInclude,
  });
  if (!recipe) throw ApiError.notFound('Recipe');

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function removeGalleryImages(recipeId: string, paths: string[]) {
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');

  const toRemove = new Set(paths);
  const remaining = existing.imageUrls.filter((key) => !toRemove.has(key));
  existing.imageUrls.filter((key) => toRemove.has(key)).forEach((key) => void deleteImage(key));

  const recipe = await prisma.recipe.update({
    where: { id: recipeId },
    data: { imageUrls: remaining },
    include: recipeFullInclude,
  });

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}
