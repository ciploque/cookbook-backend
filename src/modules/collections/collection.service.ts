import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { generateCollectionSlug } from '../../utils/slugify';
// The recipes module's public list-item contract — the same pair the shelves module renders
// with. Importing it rather than re-declaring a select here is what keeps a collection's recipe
// cards identical to the ones GET /recipes returns.
import { formatRecipeListItem, recipeListSelect } from '../recipes/recipe.service';
import {
  AddRecipesInput,
  CollectionQuery,
  CreateCollectionInput,
  PatchCollectionInput,
  UpdateCollectionInput,
} from './collection.schema';

// Collection detail shows only the first 50 recipes — see CLAUDE.md Collections section.
const MAX_INLINE_COLLECTION_RECIPES = 50;

// How many cover thumbnails a collection card shows.
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

// The three single-collection GETs only. Same membership wrapper (collectionId/recipeId/order)
// and the same 50-recipe cap — only the nested recipe grows, from a 4-field stub to the shared
// list-item shape, so a collection page can render recipe cards without N follow-up fetches.
// List and write responses stay on the light `collectionInclude` above: a page of 20
// collections × 50 recipes each has no business carrying full list items.
const collectionDetailInclude = {
  ...collectionInclude,
  recipes: {
    orderBy: { order: 'asc' as const },
    take: MAX_INLINE_COLLECTION_RECIPES,
    select: {
      collectionId: true,
      recipeId: true,
      order: true,
      recipe: { select: recipeListSelect },
    },
  },
} satisfies Prisma.CollectionInclude;

// Card thumbnails: walk the loaded recipes in `order` and collect covers until there are 4 — a
// coverless recipe is skipped rather than consuming one of the slots. Bounded by the
// `take: MAX_INLINE_COLLECTION_RECIPES` window, so this comes up short only when fewer than 4
// of the collection's first 50 members have a cover at all.
function pickCoverImages(entries: { recipe: { coverImageUrl: string | null } }[]): string[] {
  const covers: string[] = [];

  for (const { recipe } of entries) {
    if (recipe.coverImageUrl !== null) covers.push(recipe.coverImageUrl);
    if (covers.length === COLLECTION_COVER_IMAGE_COUNT) break;
  }

  return covers;
}

// Everything on a collection response except `recipes`, which is the one field whose shape
// differs between the detail reads and the rest.
function formatCollectionBase<
  T extends {
    owner: { authProviderId: string };
    recipes: { recipe: { coverImageUrl: string | null } }[];
    _count: { followers: number; recipes: number };
  },
>(collection: T) {
  const { _count, owner, recipes, ...rest } = collection;
  const { authProviderId: _ownerKey, ...ownerPublic } = owner;

  return {
    ...rest,
    owner: ownerPublic,
    coverImages: pickCoverImages(recipes),
    recipeCount: _count.recipes,
    followerCount: _count.followers,
  };
}

function formatCollection(
  collection: Prisma.CollectionGetPayload<{ include: typeof collectionInclude }>,
) {
  return { ...formatCollectionBase(collection), recipes: collection.recipes };
}

function formatCollectionDetail(
  collection: Prisma.CollectionGetPayload<{ include: typeof collectionDetailInclude }>,
) {
  return {
    ...formatCollectionBase(collection),
    recipes: collection.recipes.map(({ recipe, ...entry }) => ({
      ...entry,
      recipe: formatRecipeListItem(recipe),
    })),
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
    include: collectionDetailInclude,
  });

  if (!collection || !collection.isPublic) throw ApiError.notFound('Collection');

  return formatCollectionDetail(collection);
}

// The SEO-friendly counterpart to getCollectionById: same public-only rule, addressed by the
// owner's username and the collection's slug instead of an opaque uuid. Slug uniqueness is scoped
// per owner, so both halves are needed to identify a row — and a miss on either is the same
// 404 the id route returns, which also keeps a private collection indistinguishable from an
// absent one.
export async function getCollectionByUsernameAndSlug(username: string, slug: string) {
  const collection = await prisma.collection.findFirst({
    where: { slug, owner: { username } },
    include: collectionDetailInclude,
  });

  if (!collection || !collection.isPublic) throw ApiError.notFound('Collection');

  return formatCollectionDetail(collection);
}

// The owner-scoped counterpart: any collection the caller owns, public or private. A collection
// they don't own is a 404 rather than a 403 — a non-owner shouldn't learn the id exists, which is
// the same stance getCollectionById takes on a private one.
export async function getMyCollectionById(collectionId: string, authProviderId: string) {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: collectionDetailInclude,
  });

  if (!collection || collection.owner.authProviderId !== authProviderId) {
    throw ApiError.notFound('Collection');
  }

  return formatCollectionDetail(collection);
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
