import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import supertest from 'supertest';

// Real collection routers on a bare Express app with the service mocked — pins the HTTP
// contract: status codes, response envelope, and what each controller forwards.
vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'development' },
  allowedOrigins: [],
  trustedImageDomains: [] as string[],
}));

vi.mock('../../../src/config/database', () => ({ prisma: {} }));

vi.mock('../../../src/modules/collections/collection.service', () => ({
  getOwnerId: vi.fn(async () => 'user_owner'),
  listCollectionsByUser: vi.fn(),
  listMyCollections: vi.fn(),
  getCollectionById: vi.fn(),
  getMyCollectionById: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  patchCollection: vi.fn(),
  deleteCollection: vi.fn(),
  addRecipesToCollection: vi.fn(),
  removeRecipesFromCollection: vi.fn(),
  followCollection: vi.fn(),
  unfollowCollection: vi.fn(),
}));

import collectionRouter, {
  userCollectionsRouter,
} from '../../../src/modules/collections/collection.router';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import * as collectionService from '../../../src/modules/collections/collection.service';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/collections', collectionRouter);
  app.use('/users', userCollectionsRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const api = (): supertest.Agent => supertest(app);
const AUTH = ['x-dev-user-sub', 'user_owner'] as const;
const COLLECTION_ID = '01a005f1-abca-7302-8cc6-e9762dea4932';
const USER_ID = '01a005f1-abca-7302-8cc6-e9762dea4933';
const RECIPE_ID = '01a005f1-abca-7302-8cc6-e9762dea4934';

const collection = { id: COLLECTION_ID, name: 'Weeknight dinners', isPublic: true, recipes: [] };
const meta = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(collectionService.getOwnerId).mockResolvedValue('user_owner');
});

// ─── Reads ────────────────────────────────────────────────────────────────────

describe('GET /collections/:collectionId', () => {
  it('serves an anonymous caller', async () => {
    vi.mocked(collectionService.getCollectionById).mockResolvedValue(collection as never);

    const res = await api().get(`/collections/${COLLECTION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: collection });
    expect(collectionService.getCollectionById).toHaveBeenCalledWith(COLLECTION_ID);
  });

  // No caller identity reaches this route at all — it runs no auth middleware, so a session
  // can't change the answer. That's the whole point of the split with the /me route.
  it('passes no caller to the service even when a session is present', async () => {
    vi.mocked(collectionService.getCollectionById).mockResolvedValue(collection as never);

    await api()
      .get(`/collections/${COLLECTION_ID}`)
      .set(...AUTH);

    expect(collectionService.getCollectionById).toHaveBeenCalledWith(COLLECTION_ID);
  });

  it('surfaces the private-collection 404 rather than a 403', async () => {
    const { ApiError } = await import('../../../src/utils/ApiError');
    vi.mocked(collectionService.getCollectionById).mockRejectedValue(
      ApiError.notFound('Collection'),
    );

    const res = await api().get(`/collections/${COLLECTION_ID}`);

    // 404, not 403 — a non-owner must not learn that the collection exists.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COLLECTION_NOT_FOUND');
  });
});

describe('GET /users/:userId/collections vs /users/me/collections', () => {
  it('the by-id route scopes by the path user id and needs no session', async () => {
    vi.mocked(collectionService.listCollectionsByUser).mockResolvedValue({
      data: [collection],
      meta,
    } as never);

    const res = await api().get(`/users/${USER_ID}/collections`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [collection], meta });
    expect(collectionService.listCollectionsByUser).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  // Same pin as on GET /collections/:collectionId — a session must not widen a public list.
  it('the by-id route passes no caller even when a session is present', async () => {
    vi.mocked(collectionService.listCollectionsByUser).mockResolvedValue({
      data: [collection],
      meta,
    } as never);

    const res = await api()
      .get(`/users/${USER_ID}/collections`)
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(collectionService.listCollectionsByUser).toHaveBeenCalledWith(
      USER_ID,
      expect.anything(),
    );
  });

  it('the "me" route resolves from the session and never hits the by-id lister', async () => {
    vi.mocked(collectionService.listMyCollections).mockResolvedValue({ data: [], meta } as never);

    const res = await api()
      .get('/users/me/collections')
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(collectionService.listMyCollections).toHaveBeenCalledWith(
      'user_owner',
      expect.objectContaining({ page: 1 }),
    );
    expect(collectionService.listCollectionsByUser).not.toHaveBeenCalled();
  });

  it('the "me" route requires a session', async () => {
    const res = await api().get('/users/me/collections');

    expect(res.status).toBe(401);
    expect(collectionService.listMyCollections).not.toHaveBeenCalled();
  });
});

describe('GET /users/me/collections/:collectionId', () => {
  it('resolves the owner from the session and returns the collection', async () => {
    vi.mocked(collectionService.getMyCollectionById).mockResolvedValue(collection as never);

    const res = await api()
      .get(`/users/me/collections/${COLLECTION_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: collection });
    expect(collectionService.getMyCollectionById).toHaveBeenCalledWith(COLLECTION_ID, 'user_owner');
  });

  // Unlike the public detail route, identity is required here rather than optional — that is
  // what lets it answer with a private collection at all.
  it('requires a session', async () => {
    const res = await api().get(`/users/me/collections/${COLLECTION_ID}`);

    expect(res.status).toBe(401);
    expect(collectionService.getMyCollectionById).not.toHaveBeenCalled();
  });

  it('is not swallowed by the /:userId/collections wildcard', async () => {
    vi.mocked(collectionService.getMyCollectionById).mockResolvedValue(collection as never);

    await api()
      .get(`/users/me/collections/${COLLECTION_ID}`)
      .set(...AUTH);

    expect(collectionService.listCollectionsByUser).not.toHaveBeenCalled();
  });

  it('surfaces the not-mine 404 as the error envelope', async () => {
    const { ApiError } = await import('../../../src/utils/ApiError');
    vi.mocked(collectionService.getMyCollectionById).mockRejectedValue(
      ApiError.notFound('Collection'),
    );

    const res = await api()
      .get(`/users/me/collections/${COLLECTION_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COLLECTION_NOT_FOUND');
  });
});

// ─── Metadata CRUD ────────────────────────────────────────────────────────────

describe('POST /collections', () => {
  it('returns 201 and takes the owner from the session', async () => {
    vi.mocked(collectionService.createCollection).mockResolvedValue(collection as never);

    const res = await api()
      .post('/collections')
      .set(...AUTH)
      .send({ name: 'Weeknight dinners', isPublic: true });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: collection });
    expect(collectionService.createCollection).toHaveBeenCalledWith('user_owner', {
      name: 'Weeknight dinners',
      isPublic: true,
    });
  });

  it('defaults isPublic to false when omitted', async () => {
    vi.mocked(collectionService.createCollection).mockResolvedValue(collection as never);

    await api()
      .post('/collections')
      .set(...AUTH)
      .send({ name: 'Private ideas' });

    expect(collectionService.createCollection).toHaveBeenCalledWith(
      'user_owner',
      expect.objectContaining({ isPublic: false }),
    );
  });
});

describe('PUT / PATCH /collections/:collectionId', () => {
  it('PUT forwards the full metadata body', async () => {
    vi.mocked(collectionService.updateCollection).mockResolvedValue(collection as never);

    const res = await api()
      .put(`/collections/${COLLECTION_ID}`)
      .set(...AUTH)
      .send({ name: 'Renamed', isPublic: true });

    expect(res.status).toBe(200);
    expect(collectionService.updateCollection).toHaveBeenCalledWith(COLLECTION_ID, {
      name: 'Renamed',
      isPublic: true,
    });
  });

  // Membership is managed through the /recipes sub-routes; a metadata write must not be
  // able to replace the collection's contents.
  it('strips a recipes field from the PATCH body', async () => {
    vi.mocked(collectionService.patchCollection).mockResolvedValue(collection as never);

    await api()
      .patch(`/collections/${COLLECTION_ID}`)
      .set(...AUTH)
      .send({ name: 'Renamed', recipes: [{ recipeId: RECIPE_ID, order: 0 }] });

    expect(collectionService.patchCollection).toHaveBeenCalledWith(COLLECTION_ID, {
      name: 'Renamed',
    });
  });

  it('returns 403 without calling the service when the caller is not the owner', async () => {
    vi.mocked(collectionService.getOwnerId).mockResolvedValue('someone-else');

    const res = await api()
      .patch(`/collections/${COLLECTION_ID}`)
      .set('x-dev-user-sub', 'user_intruder')
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(collectionService.patchCollection).not.toHaveBeenCalled();
  });
});

describe('DELETE /collections/:collectionId', () => {
  it('returns 204 with an empty body', async () => {
    vi.mocked(collectionService.deleteCollection).mockResolvedValue(undefined);

    const res = await api()
      .delete(`/collections/${COLLECTION_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(collectionService.deleteCollection).toHaveBeenCalledWith(COLLECTION_ID);
  });
});

// ─── Membership ───────────────────────────────────────────────────────────────

describe('POST /collections/:collectionId/recipes', () => {
  it('forwards the whole body object, not just the array', async () => {
    vi.mocked(collectionService.addRecipesToCollection).mockResolvedValue(collection as never);

    const res = await api()
      .post(`/collections/${COLLECTION_ID}/recipes`)
      .set(...AUTH)
      .send({ recipes: [{ recipeId: RECIPE_ID, order: 0 }] });

    expect(res.status).toBe(200);
    expect(collectionService.addRecipesToCollection).toHaveBeenCalledWith(COLLECTION_ID, {
      recipes: [{ recipeId: RECIPE_ID, order: 0 }],
    });
  });

  it('rejects an empty recipes array with 422', async () => {
    const res = await api()
      .post(`/collections/${COLLECTION_ID}/recipes`)
      .set(...AUTH)
      .send({ recipes: [] });

    expect(res.status).toBe(422);
    expect(collectionService.addRecipesToCollection).not.toHaveBeenCalled();
  });
});

describe('DELETE /collections/:collectionId/recipes', () => {
  it('unwraps recipeIds from the body', async () => {
    vi.mocked(collectionService.removeRecipesFromCollection).mockResolvedValue(collection as never);

    const res = await api()
      .delete(`/collections/${COLLECTION_ID}/recipes`)
      .set(...AUTH)
      .send({ recipeIds: [RECIPE_ID] });

    expect(res.status).toBe(200);
    // The controller passes the array itself here, unlike the add route above.
    expect(collectionService.removeRecipesFromCollection).toHaveBeenCalledWith(COLLECTION_ID, [
      RECIPE_ID,
    ]);
  });
});

// ─── Follow / unfollow ────────────────────────────────────────────────────────

describe('POST / DELETE /collections/:collectionId/follow', () => {
  it('follow returns a bare success envelope with no data key', async () => {
    vi.mocked(collectionService.followCollection).mockResolvedValue(undefined as never);

    const res = await api()
      .post(`/collections/${COLLECTION_ID}/follow`)
      .set('x-dev-user-sub', 'user_follower');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(collectionService.followCollection).toHaveBeenCalledWith(COLLECTION_ID, 'user_follower');
  });

  it('unfollow forwards the caller sub', async () => {
    vi.mocked(collectionService.unfollowCollection).mockResolvedValue(undefined as never);

    const res = await api()
      .delete(`/collections/${COLLECTION_ID}/follow`)
      .set('x-dev-user-sub', 'user_follower');

    expect(res.status).toBe(200);
    expect(collectionService.unfollowCollection).toHaveBeenCalledWith(
      COLLECTION_ID,
      'user_follower',
    );
  });

  // No owner guard on these two routes — the "not your own collection" rule is the
  // service's job, so the controller must let a non-owner through to it.
  it('does not apply the owner guard to follow', async () => {
    vi.mocked(collectionService.followCollection).mockResolvedValue(undefined as never);

    await api().post(`/collections/${COLLECTION_ID}/follow`).set('x-dev-user-sub', 'user_follower');

    expect(collectionService.getOwnerId).not.toHaveBeenCalled();
  });

  it('requires a session to follow', async () => {
    const res = await api().post(`/collections/${COLLECTION_ID}/follow`);

    expect(res.status).toBe(401);
    expect(collectionService.followCollection).not.toHaveBeenCalled();
  });
});
