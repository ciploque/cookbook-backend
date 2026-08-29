import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { generateCollectionSlug } from '../../utils/slugify';
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

// The only unique constraint on Collection is @@unique([ownerId, slug]), so a P2002 from a
// create/update can only ever mean "this owner already has a collection under that slug".
function rethrowSlugConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw ApiError.conflict('You already have a collection with this name');
  }
  throw err;
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

// Public collections only, for every caller — a profile page reached by id shows the same list to
// its owner as to a stranger. The owner's full library is at /users/me/collections.
export async function listCollectionsByUser(userId: string, query: CollectionQuery) {
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!targetUser) throw ApiError.notFound('User');

  return paginateCollections({ ownerId: userId, isPublic: true }, query.page, query.limit);
}

export async function listMyCollections(authProviderId: string, query: CollectionQuery) {
  const owner = await prisma.user.findUnique({
    where: { authProviderId },
    select: { id: true },
  });
  if (!owner) throw ApiError.notFound('User');

  return paginateCollections({ ownerId: owner.id }, query.page, query.limit);
}

// Public collections only. A private one is a 404 for everyone, the owner included — they reach
// it through getMyCollectionById below, on a route that authenticates them first.
export async function getCollectionById(collectionId: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });

  if (!collection || !collection.isPublic) throw ApiError.notFound('Collection');

  return formatCollection(collection);
}

// The SEO-friendly counterpart to getCollectionById: same public-only rule, addressed by the
// owner's username and the collection's slug instead of an opaque uuid. Slug uniqueness is scoped
// per owner, so both halves are needed to identify a row — and a miss on either is the same
// 404 the id route returns, which also keeps a private collection indistinguishable from an
// absent one.
export async function getCollectionByUsernameAndSlug(username: string, slug: string) {
  const collection = await prisma.collection.findFirst({
    where: { slug, owner: { username } },
    include: collectionInclude,
  });

  if (!collection || !collection.isPublic) throw ApiError.notFound('Collection');

  return formatCollection(collection);
}

// The owner-scoped counterpart: any collection the caller owns, public or private. A collection
// they don't own is a 404 rather than a 403 — a non-owner shouldn't learn the id exists, which is
// the same stance getCollectionById takes on a private one.
export async function getMyCollectionById(collectionId: string, authProviderId: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionInclude,
  });

  if (!collection || collection.owner.authProviderId !== authProviderId) {
    throw ApiError.notFound('Collection');
  }

  return formatCollection(collection);
}

export async function createCollection(authProviderId: string, input: CreateCollectionInput) {
  const owner = await prisma.user.findUnique({ where: { authProviderId } });
  if (!owner) throw ApiError.notFound('User');

  let collection;
  try {
    collection = await prisma.collection.create({
      data: {
        ownerId: owner.id,
        slug: generateCollectionSlug(input.name),
        name: input.name,
        description: input.description,
        isPublic: input.isPublic,
      },
      include: collectionInclude,
    });
  } catch (err) {
    rethrowSlugConflict(err);
  }

  return formatCollection(collection);
}

// The slug tracks the name: renaming a collection re-slugs it, so the SEO URL always reflects the
// title on the page. Unlike Recipe.slug, which is fixed at creation — the trade-off taken here is
// that old links 404 after a rename, in exchange for never serving a stale slug.
export async function updateCollection(collectionId: string, input: UpdateCollectionInput) {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');

  let collection;
  try {
    collection = await prisma.collection.update({
      where: { id: collectionId },
      data: {
        slug: generateCollectionSlug(input.name),
        name: input.name,
        description: input.description,
        isPublic: input.isPublic,
      },
      include: collectionInclude,
    });
  } catch (err) {
    rethrowSlugConflict(err);
  }

  return formatCollection(collection);
}

export async function patchCollection(collectionId: string, input: PatchCollectionInput) {
  const existing = await prisma.collection.findUnique({ where: { id: collectionId } });
  if (!existing) throw ApiError.notFound('Collection');

  let collection;
  try {
    collection = await prisma.collection.update({
      where: { id: collectionId },
      data: {
        // Re-slugged only when the name is actually part of the patch — a PATCH that touches
        // only `isPublic` must not move the collection's URL.
        ...(input.name !== undefined && {
          slug: generateCollectionSlug(input.name),
          name: input.name,
        }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
      },
      include: collectionInclude,
    });
  } catch (err) {
    rethrowSlugConflict(err);
  }

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
