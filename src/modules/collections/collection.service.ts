import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import {
  AddRecipesInput,
  CollectionQuery,
  CreateCollectionInput,
  PatchCollectionInput,
  UpdateCollectionInput,
} from './collection.schema';

// Collection detail shows only the first 50 recipes — see CLAUDE.md Collections section.
const MAX_INLINE_COLLECTION_RECIPES = 50;

// Cover thumbnails for a collection card: the first 4 recipes by `order`, minus any without a
// cover. Deliberately not backfilled from later recipes — position is what's meaningful here.
const COLLECTION_COVER_IMAGE_COUNT = 4;

const collectionInclude = {
  owner: {
    select: { id: true, username: true, displayName: true, avatarUrl: true, authProviderId: true },
  },
  recipes: {
    orderBy: { order: 'asc' as const },
    take: MAX_INLINE_COLLECTION_RECIPES,
    include: {
      recipe: { select: { id: true, slug: true, title: true, coverImageUrl: true } },
    },
  },
  // `recipes` counts the whole membership, not the `take`-capped array above.
  _count: { select: { followers: true, recipes: true } },
} satisfies Prisma.CollectionInclude;

function formatCollection(
  collection: Prisma.CollectionGetPayload<{ include: typeof collectionInclude }>,
) {
  const {
    _count,
    owner: { authProviderId: _ownerKey, ...ownerPublic },
    recipes,
    ...rest
  } = collection;

  return {
    ...rest,
    recipes,
    owner: ownerPublic,
    coverImages: recipes
      .slice(0, COLLECTION_COVER_IMAGE_COUNT)
      .map((entry) => entry.recipe.coverImageUrl)
      .filter((url): url is string => url !== null),
    recipeCount: _count.recipes,
    followerCount: _count.followers,
  };
}

async function paginateCollections(
  where: Prisma.CollectionWhereInput,
  page: number,
  limit: number,
) {
  const skip = toSkip(page, limit);

  const [total, collections] = await Promise.all([
    prisma.collection.count({ where }),
    prisma.collection.findMany({
      where,
      include: collectionInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    data: collections.map(formatCollection),
    meta: buildMeta(page, limit, total),
  };
}

// Public-only for a visitor, but the full set when the caller *is* the user being listed —
// so a profile page reached by id shows its owner the same collections /users/me/collections does.
export async function listCollectionsByUser(
  userId: string,
  query: CollectionQuery,
  viewerAuthProviderId?: string,
) {
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, authProviderId: true },
  });
  if (!targetUser) throw ApiError.notFound('User');

  const isOwner = !!viewerAuthProviderId && viewerAuthProviderId === targetUser.authProviderId;

  return paginateCollections(
    { ownerId: userId, ...(isOwner ? {} : { isPublic: true }) },
    query.page,
    query.limit,
  );
}

export async function listMyCollections(authProviderId: string, query: CollectionQuery) {
  const owner = await prisma.user.findUnique({
    where: { authProviderId },
    select: { id: true },
  });
  if (!owner) throw ApiError.notFound('User');

  return paginateCollections({ ownerId: owner.id }, query.page, query.limit);
}

export async function getCollectionById(collectionId: string, requestingAuthProviderId?: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });

  if (!collection) throw ApiError.notFound('Collection');

  if (!collection.isPublic) {
    const isOwner =
      !!requestingAuthProviderId && requestingAuthProviderId === collection.owner.authProviderId;
    if (!isOwner) throw ApiError.notFound('Collection');
  }

  return formatCollection(collection);
}

export async function createCollection(authProviderId: string, input: CreateCollectionInput) {
  const owner = await prisma.user.findUnique({ where: { authProviderId } });
  if (!owner) throw ApiError.notFound('User');

  const collection = await prisma.collection.create({
    data: {
      ownerId: owner.id,
      name: input.name,
      description: input.description,
      isPublic: input.isPublic,
    },
    include: collectionInclude,
  });

  return formatCollection(collection);
}

export async function updateCollection(collectionId: string, input: UpdateCollectionInput) {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');

  const collection = await prisma.collection.update({
    where: { id: collectionId },
    data: { name: input.name, description: input.description, isPublic: input.isPublic },
    include: collectionInclude,
  });

  return formatCollection(collection);
}

export async function patchCollection(collectionId: string, input: PatchCollectionInput) {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');

  const collection = await prisma.collection.update({
    where: { id: collectionId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
    },
    include: collectionInclude,
  });

  return formatCollection(collection);
}

export async function deleteCollection(collectionId: string): Promise<void> {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');
  await prisma.collection.delete({ where: { id: collectionId } });
}

export async function addRecipesToCollection(collectionId: string, input: AddRecipesInput) {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');

  await prisma.collectionRecipe.createMany({
    data: input.recipes.map((r) => ({ collectionId, recipeId: r.recipeId, order: r.order })),
    skipDuplicates: true,
  });

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });
  if (!collection) throw ApiError.notFound('Collection');

  return formatCollection(collection);
}

export async function removeRecipesFromCollection(collectionId: string, recipeIds: string[]) {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');

  await prisma.collectionRecipe.deleteMany({
    where: { collectionId, recipeId: { in: recipeIds } },
  });

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });
  if (!collection) throw ApiError.notFound('Collection');

  return formatCollection(collection);
}

export async function followCollection(collectionId: string, authProviderId: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: { owner: { select: { authProviderId: true } } },
  });

  if (!collection) throw ApiError.notFound('Collection');
  if (!collection.isPublic) throw ApiError.forbidden('This collection is private');
  if (collection.owner.authProviderId === authProviderId) {
    throw ApiError.forbidden('You cannot follow your own collection');
  }

  const user = await prisma.user.findUnique({ where: { authProviderId } });
  if (!user) throw ApiError.notFound('User');

  try {
    await prisma.collectionFollower.create({ data: { collectionId, userId: user.id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('You are already following this collection');
    }
    throw err;
  }
}

export async function unfollowCollection(collectionId: string, authProviderId: string) {
  const user = await prisma.user.findUnique({ where: { authProviderId } });
  if (!user) throw ApiError.notFound('User');

  await prisma.collectionFollower.deleteMany({ where: { collectionId, userId: user.id } });
}

export async function getOwnerId(collectionId: string): Promise<string | null> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: { owner: { select: { authProviderId: true } } },
  });
  return collection?.owner.authProviderId ?? null;
}
