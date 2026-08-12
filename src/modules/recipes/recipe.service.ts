import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { generateRecipeSlug } from '../../utils/slugify';
import { upsertTags } from '../tags/tag.service';
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

const recipeFullInclude = {
  author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  ingredients: { orderBy: { order: 'asc' as const } },
  steps: { orderBy: { order: 'asc' as const } },
  recipeTags: { include: { tag: true } },
} satisfies Prisma.RecipeInclude;

function formatRecipeFull(recipe: Prisma.RecipeGetPayload<{ include: typeof recipeFullInclude }>) {
  const { recipeTags, ...rest } = recipe;
  return { ...rest, tags: recipeTags.map((rt) => rt.tag.slug) };
}

function toSearchDocument(recipe: ReturnType<typeof formatRecipeFull>): RecipeSearchDocument {
  return {
    id: recipe.id,
    slug: recipe.slug,
    title: recipe.title,
    description: recipe.description ?? null,
    authorNote: recipe.authorNote ?? null,
    category: recipe.category ?? null,
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

const recipeListSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  authorNote: true,
  category: true,
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
} satisfies Prisma.RecipeSelect;

function formatRecipeListItem(
  recipe: Prisma.RecipeGetPayload<{ select: typeof recipeListSelect }>,
) {
  const { recipeTags, description, ...rest } = recipe;
  return {
    ...rest,
    description: (description ?? '').slice(0, 200),
    tags: recipeTags.map((rt) => rt.tag.slug),
  };
}

export async function listRecipes(query: RecipeQuery) {
  if (query.q) {
    return searchRecipesViaMeili(query);
  }

  const { tags, category, authorId, minRating, page, limit, sortBy, order } = query;
  const skip = toSkip(page, limit);

  const tagSlugs = tags
    ? tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const where: Prisma.RecipeWhereInput = {
    ...(category && { category }),
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

export async function getRecipeByUsernameAndSlug(username: string, slug: string) {
  const recipe = await prisma.recipe.findFirst({
    where: { slug, author: { username } },
    include: recipeFullInclude,
  });
  if (!recipe) throw ApiError.notFound('Recipe');
  return formatRecipeFull(recipe);
}

export async function getRecipeById(id: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: recipeFullInclude,
  });
  if (!recipe) throw ApiError.notFound('Recipe');
  return formatRecipeFull(recipe);
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

  let recipe;
  try {
    recipe = await prisma.recipe.create({
      data: {
        slug,
        title: input.title,
        description: input.description,
        authorNote: input.authorNote,
        category: input.category,
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
      },
      include: recipeFullInclude,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw ApiError.conflict('You already have a recipe with this title');
    }
    throw e;
  }

  const formatted = formatRecipeFull(recipe);
  void indexRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function updateRecipe(recipeId: string, input: UpdateRecipeInput) {
  const tags = await upsertTags(input.tags);

  const recipe = await prisma.$transaction(async (tx) => {
    await tx.recipeIngredient.deleteMany({ where: { recipeId } });
    await tx.recipeStep.deleteMany({ where: { recipeId } });
    await tx.recipeTag.deleteMany({ where: { recipeId } });

    return tx.recipe.update({
      where: { id: recipeId },
      data: {
        title: input.title,
        description: input.description,
        authorNote: input.authorNote,
        category: input.category,
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
      },
      include: recipeFullInclude,
    });
  });

  const formatted = formatRecipeFull(recipe);
  void updateIndexedRecipe(toSearchDocument(formatted));
  return formatted;
}

export async function patchRecipe(recipeId: string, input: PatchRecipeInput) {
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');

  const tags = input.tags !== undefined ? await upsertTags(input.tags) : undefined;

  const recipe = await prisma.$transaction(async (tx) => {
    if (input.ingredients !== undefined) {
      await tx.recipeIngredient.deleteMany({ where: { recipeId } });
    }
    if (input.steps !== undefined) {
      await tx.recipeStep.deleteMany({ where: { recipeId } });
    }
    if (tags !== undefined) {
      await tx.recipeTag.deleteMany({ where: { recipeId } });
    }

    return tx.recipe.update({
      where: { id: recipeId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.authorNote !== undefined && { authorNote: input.authorNote }),
        ...(input.category !== undefined && { category: input.category }),
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
      },
      include: recipeFullInclude,
    });
  });

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

export async function listRecipesByUser(userId: string, query: RecipeQuery) {
  return listRecipes({ ...query, authorId: userId });
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
  const existing = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!existing) throw ApiError.notFound('Recipe');

  if (existing.imageUrls.length + buffers.length > MAX_GALLERY_IMAGES) {
    throw ApiError.validation({
      images: [
        `Maximum of ${MAX_GALLERY_IMAGES} images allowed in gallery ` +
          `(currently ${existing.imageUrls.length}, tried to add ${buffers.length})`,
      ],
    });
  }

  const newKeys = await Promise.all(
    buffers.map((buffer) => storeImage(buffer, `recipes/${recipeId}/gallery`)),
  );

  const recipe = await prisma.recipe.update({
    where: { id: recipeId },
    data: { imageUrls: [...existing.imageUrls, ...newKeys] },
    include: recipeFullInclude,
  });

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
