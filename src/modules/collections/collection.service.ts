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

const collectionInclude = {
  owner: { select: { id: true, username: true, displayName: true, avatarUrl: true, authProviderId: true } },
  recipes: {
    orderBy: { order: 'asc' as const },
    include: {
      recipe: { select: { id: true, slug: true, title: true, coverImageUrl: true } },
    },
  },
  _count: { select: { followers: true } },
} satisfies Prisma.CollectionInclude;

function formatCollection(
  collection: Prisma.CollectionGetPayload<{ include: typeof collectionInclude }>,
) {
  const { _count, owner: { authProviderId: _ownerKey, ...ownerPublic }, ...rest } = collection;
  return { ...rest, owner: ownerPublic, followerCount: _count.followers };
}

export async function listCollectionsByUser(
  userId: string,
  query: CollectionQuery,
  requestingAuthProviderId?: string,
) {
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, authProviderId: true },
  });
  if (!targetUser) throw ApiError.notFound('User');

  const isOwner = !!requestingAuthProviderId && requestingAuthProviderId === targetUser.authProviderId;
  const { page, limit } = query;
  const skip = toSkip(page, limit);

  const where: Prisma.CollectionWhereInput = {
    ownerId: userId,
    ...(!isOwner && { isPublic: true }),
  };

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

export async function getCollectionById(collectionId: string, requestingAuthProviderId?: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });

  if (!collection) throw ApiError.notFound('Collection');

  if (!collection.isPublic) {
    const isOwner = !!requestingAuthProviderId && requestingAuthProviderId === collection.owner.authProviderId;
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

  return formatCollection(collection!);
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

  return formatCollection(collection!);
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
