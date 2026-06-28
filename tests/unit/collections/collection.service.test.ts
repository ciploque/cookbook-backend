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

const mockCollectionFull = {
  id: 'collection-uuid',
  ownerId: 'owner-uuid',
  name: 'My Favourites',
  description: 'Best recipes',
  isPublic: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  owner: { id: 'owner-uuid', username: 'joao', displayName: 'João', avatarUrl: null, authProviderId: 'user_owner' },
  recipes: [
    {
      collectionId: 'collection-uuid',
      recipeId: 'recipe-uuid',
      order: 0,
      recipe: { id: 'recipe-uuid', slug: 'pasta-abcd', title: 'Pasta', coverImageUrl: null },
    },
  ],
  _count: { followers: 3 },
};

const mockPrivateCollection = {
  ...mockCollectionFull,
  id: 'private-uuid',
  isPublic: false,
  _count: { followers: 0 },
};

const mockTargetUser = { id: 'owner-uuid', authProviderId: 'user_owner' };

beforeEach(() => vi.clearAllMocks());

// ─── listCollectionsByUser ────────────────────────────────────────────────────

describe('listCollectionsByUser()', () => {
  it('returns public collections for a non-owner', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockTargetUser as never);
    vi.mocked(prisma.collection.count).mockResolvedValue(1);
    vi.mocked(prisma.collection.findMany).mockResolvedValue([mockCollectionFull] as never);

    const result = await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 }, 'user_other');

    const whereArg = vi.mocked(prisma.collection.count).mock.calls[0][0]?.where;
    expect(whereArg).toMatchObject({ isPublic: true });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveProperty('followerCount', 3);
    expect(result.data[0].owner).not.toHaveProperty('authProviderId');
  });

  it('includes private collections when requester is the owner', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockTargetUser as never);
    vi.mocked(prisma.collection.count).mockResolvedValue(2);
    vi.mocked(prisma.collection.findMany).mockResolvedValue([mockCollectionFull, mockPrivateCollection] as never);

    const result = await listCollectionsByUser('owner-uuid', { page: 1, limit: 20 }, 'user_owner');

    const whereArg = vi.mocked(prisma.collection.count).mock.calls[0][0]?.where;
    expect(whereArg).not.toHaveProperty('isPublic');
    expect(result.data).toHaveLength(2);
  });

  it('throws USER_NOT_FOUND when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(listCollectionsByUser('missing-id', { page: 1, limit: 20 })).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
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

    await expect(createCollection('user_unknown', { name: 'Test', isPublic: false })).rejects.toMatchObject({
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

    await expect(updateCollection('missing-id', { name: 'X', isPublic: false })).rejects.toMatchObject({
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
  });

  it('throws COLLECTION_NOT_FOUND when collection does not exist', async () => {
    vi.mocked(prisma.collection.findUnique).mockResolvedValue(null);

    await expect(
      addRecipesToCollection('missing-id', { recipes: [{ recipeId: 'recipe-uuid', order: 0 }] }),
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
      expect.objectContaining({ data: expect.objectContaining({ collectionId: 'collection-uuid' }) }),
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
