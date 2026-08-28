import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    collection: {
      findUnique: vi.fn(),
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

import { prisma } from '../../../src/config/database';
import {
  listCollectionsByUser,
  listMyCollections,
  getCollectionById,
  createCollection,
  updateCollection,
  patchCollection,
  deleteCollection,
  addRecipesToCollection,
  removeRecipesFromCollection,
  followCollection,
  unfollowCollection,
  getOwnerId,
} from '../../../src/modules/collections/collection.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockOwner = {
  id: 'owner-uuid',
  authProviderId: 'user_owner',
  username: 'joao',
  displayName: 'João',
  avatarUrl: null,
};

function buildCollectionRecipe(order: number, coverImageUrl: string | null) {
  const recipeId = `recipe-uuid-${order}`;
  return {
    collectionId: 'collection-uuid',
    recipeId,
    order,
    recipe: { id: recipeId, slug: `pasta-${order}`, title: `Pasta ${order}`, coverImageUrl },
  };
}

const mockCollectionFull = {
  id: 'collection-uuid',
  ownerId: 'owner-uuid',
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
  // 5 entries, the 2nd without a cover — exercises both the 4-item slice and the "omit, don't
  // backfill" rule for coverImages.
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

  it('filters to public collections for an anonymous caller', async () => {
    mockList([mockCollectionFull]);

    const result = await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 });

    expect(whereArg()).toMatchObject({ ownerId: 'owner-uuid', isPublic: true });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveProperty('followerCount', 3);
    expect(result.data[0].owner).not.toHaveProperty('authProviderId');
  });

  it('filters to public collections for a signed-in caller who is not the owner', async () => {
    mockList([mockCollectionFull]);

    await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 }, 'user_someone_else');

    expect(whereArg()).toMatchObject({ ownerId: 'owner-uuid', isPublic: true });
  });

  it('returns private collections too when the caller is the listed user', async () => {
    mockList([mockCollectionFull, mockPrivateCollection]);

    const result = await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 }, 'user_owner');

    expect(whereArg()).toMatchObject({ ownerId: 'owner-uuid' });
    expect(whereArg()).not.toHaveProperty('isPublic');
    expect(result.data).toHaveLength(2);
  });

  it('resolves ownership from the target user row, not the requested id', async () => {
    mockList([mockCollectionFull]);

    await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 }, 'user_owner');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'owner-uuid' },
      select: { id: true, authProviderId: true },
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

  it('takes the covers of the first 4 recipes by order, omitting those without one', async () => {
    const item = await listOne(mockCollectionFull);

    // The 2nd recipe has no cover, so it is dropped — and the 5th is NOT pulled in to backfill.
    expect(item.coverImages).toEqual([
      '/recipes/r1/cover/a.jpg',
      '/recipes/r3/cover/c.jpg',
      '/recipes/r4/cover/d.jpg',
    ]);
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

  it('returns an empty array when none of the first 4 recipes has a cover', async () => {
    const item = await listOne({
      ...mockCollectionFull,
      recipes: [0, 1, 2, 3].map((i) => buildCollectionRecipe(i, null)),
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

  it('asks Prisma for the recipe count in the same query', async () => {
    await listOne(mockCollectionFull);

    const include = vi.mocked(prisma.collection.findMany).mock.calls[0][0]?.include;
    expect(include?._count).toMatchObject({ select: { followers: true, recipes: true } });
  });
});

// ─── getCollectionById ────────────────────────────────────────────────────────

describe('getCollectionById()', () => {
  it('returns a public collection to anyone', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);

    const result = await getCollectionById('collection-uuid');

    expect(result).toHaveProperty('id', 'collection-uuid');
    expect(result.owner).not.toHaveProperty('authProviderId');
  });

  // The two fields live on the shared Collection shape, so the detail GET carries them too.
  it('carries coverImages and recipeCount on the detail response', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockCollectionFull as never);

    const result = await getCollectionById('collection-uuid');

    expect(result.coverImages).toEqual([
      '/recipes/r1/cover/a.jpg',
      '/recipes/r3/cover/c.jpg',
      '/recipes/r4/cover/d.jpg',
    ]);
    expect(result.recipeCount).toBe(12);
  });

  it('returns a private collection to its owner', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockPrivateCollection as never);

    const result = await getCollectionById('private-uuid', 'user_owner');

    expect(result).toHaveProperty('id', 'private-uuid');
  });

  it('throws COLLECTION_NOT_FOUND for private collection accessed by non-owner', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(mockPrivateCollection as never);

    await expect(getCollectionById('private-uuid', 'user_other')).rejects.toMatchObject({
      statusCode: 404,
      code: 'COLLECTION_NOT_FOUND',
    });
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(getCollectionById('missing-id')).rejects.toMatchObject({
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
