import { describe, it, expect, vi, beforeEach } from 'vitest';

// The service now imports recipeListSelect/formatRecipeListItem from the recipes module, whose
// import chain reaches config/env (which would process.exit(1) on unset vars) via
// recipe.search -> config/meilisearch. Same reasoning as the shelves suite's env mock.
vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'test', MEILISEARCH_URL: 'http://localhost:7700', MEILISEARCH_API_KEY: 'key' },
  allowedOrigins: [],
  trustedImageDomains: [] as string[],
}));
vi.mock('../../../src/modules/recipes/recipe.search', () => ({
  indexRecipe: vi.fn(),
  updateIndexedRecipe: vi.fn(),
  updateIndexedRecipeRating: vi.fn(),
  deleteIndexedRecipe: vi.fn(),
  searchRecipesViaMeili: vi.fn(),
}));

vi.mock('../../../src/config/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    collection: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    collectionRecipe: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    collectionFollower: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../../../src/config/database';
import {
  listCollectionsByUser,
  listMyCollections,
  getCollectionById,
  getCollectionByUsernameAndSlug,
  createCollection,
  updateCollection,
  patchCollection,
  deleteCollection,
  addRecipesToCollection,
  removeRecipesFromCollection,
  followCollection,
  unfollowCollection,
  getOwnerId,
  getMyCollectionById,
} from '../../../src/modules/collections/collection.service';
// The detail reads nest this verbatim — asserting against the real export is what keeps the
// collection's recipe cards from drifting away from GET /recipes'.
import { recipeListSelect } from '../../../src/modules/recipes/recipe.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockOwner = {
  id: 'owner-uuid',
  authProviderId: 'user_owner',
  username: 'joao',
  displayName: 'João',
  avatarUrl: null,
};

// The light nested recipe returned by the list endpoints and every write response.
function buildCollectionRecipe(order: number, coverImageUrl: string | null) {
  const recipeId = `recipe-uuid-${order}`;
  return {
    collectionId: 'collection-uuid',
    recipeId,
    order,
    recipe: { id: recipeId, slug: `pasta-${order}`, title: `Pasta ${order}`, coverImageUrl },
  };
}

// The recipeListSelect payload the three single-collection GETs load — same membership wrapper,
// a full recipe underneath. Mirrors what Prisma returns for `collectionDetailInclude`, so
// formatRecipeListItem has the relation rows it flattens (recipeTags/recipeCategories).
function buildDetailCollectionRecipe(order: number, coverImageUrl: string | null) {
  const recipeId = `recipe-uuid-${order}`;
  return {
    collectionId: 'collection-uuid',
    recipeId,
    order,
    recipe: {
      id: recipeId,
      slug: `pasta-${order}`,
      title: `Pasta ${order}`,
      description: 'x'.repeat(250),
      authorNote: 'A note',
      coverImageUrl,
      imageUrls: [],
      videoUrl: null,
      prepTimeMinutes: 15,
      difficulty: 2,
      averageRating: 4.5,
      reviewCount: 8,
      createdAt: new Date('2024-01-01'),
      author: { id: 'owner-uuid', username: 'joao', displayName: 'João' },
      recipeTags: [{ tag: { id: 't1', name: 'Pasta', slug: 'pasta' } }],
      recipeCategories: [{ category: { id: 'c1', name: 'Mains', slug: 'mains' } }],
    },
  };
}

const mockCollectionFull = {
  id: 'collection-uuid',
  ownerId: 'owner-uuid',
  slug: 'my-favourites',
  name: 'My Favourites',
  description: 'Best recipes',
  isPublic: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  owner: {
    id: 'owner-uuid',
    username: 'joao',
    displayName: 'João',
    avatarUrl: null,
    authProviderId: 'user_owner',
  },
  // 5 entries, the 2nd without a cover — a coverless recipe must be skipped over rather than
  // consume one of the 4 cover slots, so the 5th recipe's cover is pulled in to complete the set.
  recipes: [
    buildCollectionRecipe(0, '/recipes/r1/cover/a.jpg'),
    buildCollectionRecipe(1, null),
    buildCollectionRecipe(2, '/recipes/r3/cover/c.jpg'),
    buildCollectionRecipe(3, '/recipes/r4/cover/d.jpg'),
    buildCollectionRecipe(4, '/recipes/r5/cover/e.jpg'),
  ],
  // `recipes` above is the take:50-capped array; `_count.recipes` is the real membership.
  _count: { followers: 3, recipes: 12 },
};

const mockPrivateCollection = {
  ...mockCollectionFull,
  id: 'private-uuid',
  isPublic: false,
  _count: { followers: 0, recipes: 12 },
};

// The same collection as Prisma returns it for the three detail GETs: identical everywhere
// except that each `recipes[].recipe` is the fuller recipeListSelect payload.
const mockCollectionDetail = {
  ...mockCollectionFull,
  recipes: [
    buildDetailCollectionRecipe(0, '/recipes/r1/cover/a.jpg'),
    buildDetailCollectionRecipe(1, null),
    buildDetailCollectionRecipe(2, '/recipes/r3/cover/c.jpg'),
    buildDetailCollectionRecipe(3, '/recipes/r4/cover/d.jpg'),
    buildDetailCollectionRecipe(4, '/recipes/r5/cover/e.jpg'),
  ],
};

const mockPrivateCollectionDetail = {
  ...mockCollectionDetail,
  id: 'private-uuid',
  isPublic: false,
  _count: { followers: 0, recipes: 12 },
};

const mockTargetUser = { id: 'owner-uuid', authProviderId: 'user_owner' };

beforeEach(() => vi.clearAllMocks());

// ─── listCollectionsByUser ────────────────────────────────────────────────────

describe('listCollectionsByUser()', () => {
  function mockList(collections: unknown[]) {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockTargetUser as never);
    vi.mocked(prisma.collection.count).mockResolvedValue(collections.length);
    vi.mocked(prisma.collection.findMany).mockResolvedValue(collections as never);
  }

  const whereArg = () => vi.mocked(prisma.collection.count).mock.calls[0][0]?.where;

  it('filters to public collections', async () => {
    mockList([mockCollectionFull]);

    const result = await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 });

    expect(whereArg()).toMatchObject({ ownerId: 'owner-uuid', isPublic: true });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveProperty('followerCount', 3);
    expect(result.data[0].owner).not.toHaveProperty('authProviderId');
  });

  // The signature takes no caller. Pinned so nobody reintroduces an owner-aware branch by
  // threading a sub through — the owner's full library is listMyCollections()'s job.
  it('stays public-filtered even when the listed user themselves is the caller', async () => {
    mockList([mockCollectionFull]);

    type Query = { page: number; limit: number };
    await (listCollectionsByUser as (id: string, q: Query, sub?: string) => Promise<unknown>)(
      'owner-uuid',
      { page: 1, limit: 20 },
      'user_owner',
    );

    expect(whereArg()).toMatchObject({ ownerId: 'owner-uuid', isPublic: true });
  });

  it('looks the target user up only to 404 on an unknown id', async () => {
    mockList([mockCollectionFull]);

    await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'owner-uuid' },
      select: { id: true },
    });
  });

  it('throws USER_NOT_FOUND when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(listCollectionsByUser('missing-id', { page: 1, limit: 20 })).rejects.toMatchObject(
      {
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      },
    );
  });
});

// ─── listMyCollections ─────────────────────────────────────────────────────────

describe('listMyCollections()', () => {
  it('returns all (public + private) collections for the authenticated owner', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockTargetUser as never);
    vi.mocked(prisma.collection.count).mockResolvedValue(2);
    vi.mocked(prisma.collection.findMany).mockResolvedValue([
      mockCollectionFull,
      mockPrivateCollection,
    ] as never);

    const result = await listMyCollections('user_owner', { page: 1, limit: 20 });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authProviderId: 'user_owner' } }),
    );
    const whereArg = vi.mocked(prisma.collection.count).mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ ownerId: 'owner-uuid' });
    expect(whereArg).not.toHaveProperty('isPublic');
    expect(result.data).toHaveLength(2);
  });

  it('throws USER_NOT_FOUND when the authenticated user has no provisioned User row', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      listMyCollections('user_unprovisioned', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
  });
});

// ─── coverImages / recipeCount ────────────────────────────────────────────────

describe('coverImages + recipeCount', () => {
  async function listOne(collection: unknown) {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockTargetUser as never);
    vi.mocked(prisma.collection.count).mockResolvedValue(1);
    vi.mocked(prisma.collection.findMany).mockResolvedValue([collection] as never);

    const result = await listMyCollections('user_owner', { page: 1, limit: 20 });
    return result.data[0];
  }

  it('walks the recipes in order, skipping coverless ones, until it has 4 covers', async () => {
    const item = await listOne(mockCollectionFull);

    // The 2nd recipe has no cover, so it is skipped and the 5th completes the set — a coverless
    // recipe must not consume one of the 4 slots and leave the card half-empty.
    expect(item.coverImages).toEqual([
      '/recipes/r1/cover/a.jpg',
      '/recipes/r3/cover/c.jpg',
      '/recipes/r4/cover/d.jpg',
      '/recipes/r5/cover/e.jpg',
    ]);
  });

  // The scan has no window of its own — it runs to the end of the loaded recipes if it must.
  it('reaches well past the first 4 entries to complete the set', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [
        buildCollectionRecipe(0, '/a.jpg'),
        ...[1, 2, 3, 4, 5, 6].map((i) => buildCollectionRecipe(i, null)),
        buildCollectionRecipe(7, '/b.jpg'),
        buildCollectionRecipe(8, null),
        buildCollectionRecipe(9, '/c.jpg'),
        buildCollectionRecipe(10, '/d.jpg'),
        buildCollectionRecipe(11, '/e.jpg'),
      ],
    });

    expect(item.coverImages).toEqual(['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg']);
  });

  // Bounded by the take:50 window the recipes array is loaded with — nothing beyond it is
  // consulted, so a collection whose loaded members are all coverless stays short.
  it('comes up short when the loaded recipes hold fewer than 4 covers', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [
        buildCollectionRecipe(0, null),
        buildCollectionRecipe(1, '/only.jpg'),
        buildCollectionRecipe(2, null),
      ],
    });

    expect(item.coverImages).toEqual(['/only.jpg']);
  });

  it('caps at 4 even when every one of the first recipes has a cover', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [0, 1, 2, 3, 4, 5].map((i) => buildCollectionRecipe(i, `/recipes/r${i}/cover.jpg`)),
    });

    expect(item.coverImages).toHaveLength(4);
    expect(item.coverImages).toEqual([
      '/recipes/r0/cover.jpg',
      '/recipes/r1/cover.jpg',
      '/recipes/r2/cover.jpg',
      '/recipes/r3/cover.jpg',
    ]);
  });

  it('returns only what exists when the collection has fewer than 4 recipes', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [buildCollectionRecipe(0, '/a.jpg'), buildCollectionRecipe(1, '/b.jpg')],
      _count: { followers: 3, recipes: 2 },
    });

    expect(item.coverImages).toEqual(['/a.jpg', '/b.jpg']);
    expect(item.recipeCount).toBe(2);
  });

  it('returns an empty array for a collection with no recipes', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [],
      _count: { followers: 3, recipes: 0 },
    });

    expect(item.coverImages).toEqual([]);
    expect(item.recipeCount).toBe(0);
  });

  it('returns an empty array when no loaded recipe has a cover at all', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [0, 1, 2, 3, 4, 5].map((i) => buildCollectionRecipe(i, null)),
    });

    expect(item.coverImages).toEqual([]);
  });

  it('reports the true membership total, not the length of the capped recipes array', async () => {
    const item = await listOne(mockCollectionFull);

    expect(item.recipes).toHaveLength(5);
    expect(item.recipeCount).toBe(12);
  });

  it('still returns the recipes array alongside the new fields', async () => {
    const item = await listOne(mockCollectionFull);

    expect(item.recipes[0]).toMatchObject({ recipeId: 'recipe-uuid-0', order: 0 });
    expect(item).toHaveProperty('followerCount', 3);
  });

  // Only the three single-collection GETs carry the full list item. A page of 20 collections ×
  // up to 50 recipes each must not quietly grow into that shape.
  it('keeps the light 4-field recipe stub on the list endpoints', async () => {
    const item = await listOne(mockCollectionFull);

    expect(item.recipes[0].recipe).toEqual({
      id: 'recipe-uuid-0',
      slug: 'pasta-0',
      title: 'Pasta 0',
      coverImageUrl: '/recipes/r1/cover/a.jpg',
    });

    const include = vi.mocked(prisma.collection.findMany).mock.calls[0][0]?.include;
    expect(include?.recipes).toMatchObject({
      take: 50,
      include: {
        recipe: { select: { id: true, slug: true, title: true, coverImageUrl: true } },
      },
    });
  });

  it('asks Prisma for the recipe count in the same query', async () => {
    await listOne(mockCollectionFull);

    const include = vi.mocked(prisma.collection.findMany).mock.calls[0][0]?.include;
    expect(include?._count).toMatchObject({ select: { followers: true, recipes: true } });
  });
});

// ─── getCollectionById ────────────────────────────────────────────────────────

describe('getCollectionById()', () => {
  it('returns a public collection to anyone', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    const result = await getCollectionById('collection-uuid');

    expect(result).toHaveProperty('id', 'collection-uuid');
    expect(result.owner).not.toHaveProperty('authProviderId');
  });

  // The detail reads render recipe cards, so each membership entry carries the same abbreviated
  // recipe GET /recipes returns — relations flattened to slug arrays, description truncated.
  it('returns each recipe in the shared list-item shape', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    const result = await getCollectionById('collection-uuid');

    // The membership wrapper is unchanged — only what hangs off `recipe` grew.
    expect(result.recipes[0]).toMatchObject({
      collectionId: 'collection-uuid',
      recipeId: 'recipe-uuid-0',
      order: 0,
    });
    expect(result.recipes[0].recipe).toMatchObject({
      id: 'recipe-uuid-0',
      slug: 'pasta-0',
      title: 'Pasta 0',
      authorNote: 'A note',
      prepTimeMinutes: 15,
      difficulty: 2,
      averageRating: 4.5,
      reviewCount: 8,
      author: { id: 'owner-uuid', username: 'joao', displayName: 'João' },
      tags: ['pasta'],
      categories: ['mains'],
    });
    expect(result.recipes[0].recipe.description).toHaveLength(200);
    // Resolved from the caller's own sub one layer up in listRecipes(), which has no counterpart
    // here — same reason shelf items don't carry it either.
    expect(result.recipes[0].recipe).not.toHaveProperty('isSavedInCollection');
    expect(result.recipes[0].recipe).not.toHaveProperty('recipeTags');
    expect(result.recipes[0].recipe).not.toHaveProperty('recipeCategories');
  });

  it('loads the recipes through the shared recipe list select, still capped at 50', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    await getCollectionById('collection-uuid');

    const include = vi.mocked(prisma.collection.findUnique).mock.calls[0][0]?.include;
    expect(include?.recipes).toMatchObject({
      take: 50,
      orderBy: { order: 'asc' },
      select: {
        collectionId: true,
        recipeId: true,
        order: true,
        recipe: { select: recipeListSelect },
      },
    });
  });

  // The two fields live on the shared Collection shape, so the detail GET carries them too.
  it('carries coverImages and recipeCount on the detail response', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    const result = await getCollectionById('collection-uuid');

    expect(result.coverImages).toEqual([
      '/recipes/r1/cover/a.jpg',
      '/recipes/r3/cover/c.jpg',
      '/recipes/r4/cover/d.jpg',
      '/recipes/r5/cover/e.jpg',
    ]);
    expect(result.recipeCount).toBe(12);
  });

  it('throws COLLECTION_NOT_FOUND for a private collection', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockPrivateCollectionDetail as never);

    await expect(getCollectionById('private-uuid')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  // No caller can unlock a private collection here — not even its owner, who reads it through
  // getMyCollectionById() on an authenticated route instead.
  it('404s a private collection even when its owner is the caller', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockPrivateCollectionDetail as never);

    await expect(
      (getCollectionById as (id: string, sub?: string) => Promise<unknown>)(
        'private-uuid',
        'user_owner',
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'COLLECTION_NOT_FOUND' });
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(getCollectionById('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });
});

// ─── getCollectionByUsernameAndSlug ───────────────────────────────────────────

describe('getCollectionByUsernameAndSlug()', () => {
  it('returns a public collection, matched on slug + owner username', async () => {
    vi.mocked(prisma.collection.findFirst).mockResolvedValue(mockCollectionDetail as never);

    const result = await getCollectionByUsernameAndSlug('joao', 'my-favourites');

    expect(prisma.collection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'my-favourites', owner: { username: 'joao' } },
      }),
    );
    expect(result).toHaveProperty('id', 'collection-uuid');
    expect(result).toHaveProperty('slug', 'my-favourites');
    expect(result.owner).not.toHaveProperty('authProviderId');
  });

  // Same shared shape as the id route — this is the SEO alias, not a second response format.
  // Byte-identical results also pin that both routes got the list-item recipes, not just one.
  it('carries coverImages, recipeCount and list-item recipes, exactly as the id route does', async () => {
    vi.mocked(prisma.collection.findFirst).mockResolvedValue(mockCollectionDetail as never);
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    const bySlug = await getCollectionByUsernameAndSlug('joao', 'my-favourites');
    const byId = await getCollectionById('collection-uuid');

    expect(bySlug).toEqual(byId);
    expect(bySlug.recipes[0].recipe).toMatchObject({ tags: ['pasta'], categories: ['mains'] });
  });

  it('throws COLLECTION_NOT_FOUND for a private collection', async () => {
    vi.mocked(prisma.collection.findFirst).mockResolvedValue(mockPrivateCollectionDetail as never);

    await expect(getCollectionByUsernameAndSlug('joao', 'secret')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  // An unknown username and an unknown slug are indistinguishable — one query, one 404.
  it('throws COLLECTION_NOT_FOUND when neither the username nor the slug matches', async () => {
    vi.mocked(prisma.collection.findFirst).mockResolvedValue(null);

    await expect(getCollectionByUsernameAndSlug('nobody', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });
});

// ─── getMyCollectionById ──────────────────────────────────────────────────────

describe('getMyCollectionById()', () => {
  it('returns the caller’s own private collection', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockPrivateCollectionDetail as never);

    const result = await getMyCollectionById('private-uuid', 'user_owner');

    expect(result).toHaveProperty('id', 'private-uuid');
    expect(result.owner).not.toHaveProperty('authProviderId');
  });

  it('returns the caller’s own public collection too', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    const result = await getMyCollectionById('collection-uuid', 'user_owner');

    expect(result).toHaveProperty('id', 'collection-uuid');
    expect(result.recipeCount).toBe(12);
  });

  // The third detail read — same recipe shape as the two public ones.
  it('returns list-item recipes, exactly as the public detail routes do', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    const result = await getMyCollectionById('collection-uuid', 'user_owner');

    expect(result.recipes[0]).toMatchObject({ recipeId: 'recipe-uuid-0', order: 0 });
    expect(result.recipes[0].recipe).toMatchObject({
      averageRating: 4.5,
      tags: ['pasta'],
      categories: ['mains'],
    });
  });

  // 404, not 403: a non-owner shouldn't learn the id exists. Public-ness is irrelevant here —
  // this route answers "is it mine", and the public one already serves everyone else.
  it('404s a collection owned by somebody else, public or not', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionDetail as never);

    await expect(getMyCollectionById('collection-uuid', 'user_other')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(getMyCollectionById('missing-id', 'user_owner')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });
});

// ─── createCollection ─────────────────────────────────────────────────────────

describe('createCollection()', () => {
  it('creates and returns the collection', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collection.create).mockResolvedValue(mockCollectionFull as never);

    const result = await createCollection('user_owner', {
      name: 'My Favourites',
      description: 'Best recipes',
      isPublic: true,
    });

    expect(prisma.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 'owner-uuid', name: 'My Favourites' }),
      }),
    );
    expect(result).toHaveProperty('name', 'My Favourites');
  });

  it('throws USER_NOT_FOUND when user has no profile', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      createCollection('user_unknown', { name: 'Test', isPublic: false }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });

    expect(prisma.collection.create).not.toHaveBeenCalled();
  });

  it('derives the slug from the name', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collection.create).mockResolvedValue(mockCollectionFull as never);

    await createCollection('user_owner', { name: 'Weeknight Dinners!', isPublic: true });

    expect(prisma.collection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'weeknight-dinners' }),
      }),
    );
  });

  // The only unique constraint on Collection is [ownerId, slug], so P2002 can only mean the
  // caller already has a collection under this name.
  it('maps the [ownerId, slug] unique violation to 409 CONFLICT', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collection.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['ownerId', 'slug'] },
      }),
    );

    await expect(
      createCollection('user_owner', { name: 'My Favourites', isPublic: true }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('re-throws an unexpected create error untouched', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collection.create).mockRejectedValue(new Error('connection lost'));

    await expect(
      createCollection('user_owner', { name: 'My Favourites', isPublic: true }),
    ).rejects.toThrow('connection lost');
  });
});

// ─── updateCollection ─────────────────────────────────────────────────────────

describe('updateCollection()', () => {
  it('updates metadata and leaves recipes untouched', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockResolvedValue({
      ...mockCollectionFull,
      name: 'Updated Name',
    } as never);

    const result = await updateCollection('collection-uuid', {
      name: 'Updated Name',
      isPublic: true,
    });

    expect(prisma.collectionRecipe).toBeUndefined;
    expect(prisma.collection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Updated Name' }),
      }),
    );
    expect(result).toHaveProperty('name', 'Updated Name');
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(
      updateCollection('missing-id', { name: 'X', isPublic: false }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  // Unlike Recipe.slug, which is frozen at creation: a renamed collection gets a new URL so the
  // slug never contradicts the title on the page.
  it('re-derives the slug from the new name', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockResolvedValue(mockCollectionFull as never);

    await updateCollection('collection-uuid', { name: 'Quick Suppers', isPublic: true });

    expect(vi.mocked(prisma.collection.update).mock.calls[0][0].data).toMatchObject({
      slug: 'quick-suppers',
      name: 'Quick Suppers',
    });
  });

  it('maps a slug collision with another of the owner’s collections to 409 CONFLICT', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['ownerId', 'slug'] },
      }),
    );

    await expect(
      updateCollection('collection-uuid', { name: 'Taken Name', isPublic: true }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });
});

// ─── patchCollection ──────────────────────────────────────────────────────────

describe('patchCollection()', () => {
  it('updates only the provided fields', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockResolvedValue({
      ...mockCollectionFull,
      isPublic: false,
    } as never);

    await patchCollection('collection-uuid', { isPublic: false });

    const updateData = vi.mocked(prisma.collection.update).mock.calls[0][0].data;
    expect(updateData).toHaveProperty('isPublic', false);
    expect(updateData).not.toHaveProperty('name');
    expect(updateData).not.toHaveProperty('description');
  });

  // A patch that never mentions the name must not move the collection's public URL.
  it('leaves the slug alone when the patch does not include a name', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockResolvedValue(mockCollectionFull as never);

    await patchCollection('collection-uuid', { description: 'Only this' });

    expect(vi.mocked(prisma.collection.update).mock.calls[0][0].data).not.toHaveProperty('slug');
  });

  it('re-derives the slug when the patch renames the collection', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockResolvedValue(mockCollectionFull as never);

    await patchCollection('collection-uuid', { name: 'Quick Suppers' });

    expect(vi.mocked(prisma.collection.update).mock.calls[0][0].data).toMatchObject({
      slug: 'quick-suppers',
      name: 'Quick Suppers',
    });
  });

  it('maps a slug collision to 409 CONFLICT', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: ['ownerId', 'slug'] },
      }),
    );

    await expect(patchCollection('collection-uuid', { name: 'Taken Name' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });
});

// ─── deleteCollection ─────────────────────────────────────────────────────────

describe('deleteCollection()', () => {
  it('deletes the collection when it exists', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);
    vi.mocked(prisma.collection.delete).mockResolvedValue(mockCollectionFull as never);

    await deleteCollection('collection-uuid');

    expect(prisma.collection.delete).toHaveBeenCalledWith({ where: { id: 'collection-uuid' } });
  });

  it('throws COLLECTION_NOT_FOUND before attempting delete', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(deleteCollection('missing-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });

    expect(prisma.collection.delete).not.toHaveBeenCalled();
  });
});

// ─── addRecipesToCollection ───────────────────────────────────────────────────

describe('addRecipesToCollection()', () => {
  it('creates recipe rows with skipDuplicates and returns updated collection', async () => {
    vi.mocked(prisma.collection.findUnique)
      .mockResolvedValueOnce(mockCollectionFull as never)
      .mockResolvedValueOnce(mockCollectionFull as never);
    vi.mocked(prisma.collectionRecipe.createMany).mockResolvedValue({ count: 1 });

    const result = await addRecipesToCollection('collection-uuid', {
      recipes: [{ recipeId: 'recipe-uuid', order: 0 }],
    });

    expect(prisma.collectionRecipe.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(result).toHaveProperty('id', 'collection-uuid');
    expect(prisma.collection.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          recipes: expect.objectContaining({ take: 50 }),
        }),
      }),
    );
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(
      addRecipesToCollection('missing-id', { recipes: [{ recipeId: 'recipe-uuid', order: 0 }] }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'COLLECTION_NOT_FOUND' });
  });

  it('throws COLLECTION_NOT_FOUND if the collection was deleted between mutation and re-fetch', async () => {
    vi.mocked(prisma.collection.findUnique)
      .mockResolvedValueOnce(mockCollectionFull as never) // initial existence check
      .mockResolvedValueOnce(null); // deleted concurrently before the re-fetch
    vi.mocked(prisma.collectionRecipe.createMany).mockResolvedValue({ count: 1 });

    await expect(
      addRecipesToCollection('collection-uuid', {
        recipes: [{ recipeId: 'recipe-uuid', order: 0 }],
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'COLLECTION_NOT_FOUND' });
  });
});

// ─── removeRecipesFromCollection ──────────────────────────────────────────────

describe('removeRecipesFromCollection()', () => {
  it('deletes matched recipe rows and returns updated collection', async () => {
    vi.mocked(prisma.collection.findUnique)
      .mockResolvedValueOnce(mockCollectionFull as never)
      .mockResolvedValueOnce(mockCollectionFull as never);
    vi.mocked(prisma.collectionRecipe.deleteMany).mockResolvedValue({ count: 1 });

    await removeRecipesFromCollection('collection-uuid', ['recipe-uuid']);

    expect(prisma.collectionRecipe.deleteMany).toHaveBeenCalledWith({
      where: { collectionId: 'collection-uuid', recipeId: { in: ['recipe-uuid'] } },
    });
  });

  it('throws COLLECTION_NOT_FOUND if the collection was deleted between mutation and re-fetch', async () => {
    vi.mocked(prisma.collection.findUnique)
      .mockResolvedValueOnce(mockCollectionFull as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.collectionRecipe.deleteMany).mockResolvedValue({ count: 1 });

    await expect(
      removeRecipesFromCollection('collection-uuid', ['recipe-uuid']),
    ).rejects.toMatchObject({ statusCode: 404, code: 'COLLECTION_NOT_FOUND' });
  });
});

// ─── followCollection ─────────────────────────────────────────────────────────

describe('followCollection()', () => {
  const mockCollectionWithOwner = {
    id: 'collection-uuid',
    isPublic: true,
    owner: { authProviderId: 'user_owner' },
  };

  it('creates a follower row on success', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionWithOwner as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collectionFollower.create).mockResolvedValue({} as never);

    await followCollection('collection-uuid', 'user_other');

    expect(prisma.collectionFollower.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ collectionId: 'collection-uuid' }),
      }),
    );
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(followCollection('missing-id', 'user_other')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  it('throws FORBIDDEN when collection is private', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue({
      ...mockCollectionWithOwner,
      isPublic: false,
    } as never);

    await expect(followCollection('collection-uuid', 'user_other')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('throws FORBIDDEN when user tries to follow their own collection', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionWithOwner as never);

    await expect(followCollection('collection-uuid', 'user_owner')).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('throws CONFLICT when user is already following', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });

    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionWithOwner as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collectionFollower.create).mockRejectedValue(p2002);

    await expect(followCollection('collection-uuid', 'user_other')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
  });
});

// ─── unfollowCollection ───────────────────────────────────────────────────────

describe('unfollowCollection()', () => {
  it('deletes the follower row (no-op if not following)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwner as never);
    vi.mocked(prisma.collectionFollower.deleteMany).mockResolvedValue({ count: 0 });

    await unfollowCollection('collection-uuid', 'user_other');

    expect(prisma.collectionFollower.deleteMany).toHaveBeenCalledWith({
      where: { collectionId: 'collection-uuid', userId: 'owner-uuid' },
    });
  });
});

// ─── getOwnerId ───────────────────────────────────────────────────────────────

describe('getOwnerId()', () => {
  it('returns the authProviderId of the collection owner', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue({
      owner: { authProviderId: 'user_owner' },
    } as never);

    const result = await getOwnerId('collection-uuid');
    expect(result).toBe('user_owner');
  });

  it('returns null when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    const result = await getOwnerId('missing-id');
    expect(result).toBeNull();
  });
});
