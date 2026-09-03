import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import supertest from 'supertest';

// Routers are mounted on a bare Express app (no helmet/cors/clerk) so these tests exercise
// only the middleware chain: params validation → owner guard → controller.
vi.mock('../../../src/config/env', () => ({
  env: {
    NODE_ENV: 'development',
    MEILISEARCH_URL: 'http://localhost:7700',
    MEILISEARCH_API_KEY: 'masterkey',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'bucket',
  },
  allowedOrigins: [],
  trustedImageDomains: [] as string[],
}));

vi.mock('../../../src/config/database', () => ({ prisma: {} }));

vi.mock('../../../src/modules/recipes/recipe.service', () => ({
  getRecipeAuthorId: vi.fn(async () => 'dev-user'),
  getRecipeById: vi.fn(async () => ({ id: 'ok' })),
  listRecipes: vi.fn(async () => ({ data: [], meta: {} })),
  listRecipesByUser: vi.fn(async () => ({ data: [], meta: {} })),
  getRecipeByUsernameAndSlug: vi.fn(async () => ({ id: 'ok' })),
}));

vi.mock('../../../src/modules/reviews/review.service', () => ({
  getReviewAuthorId: vi.fn(async () => 'dev-user'),
  listReviewsByRecipe: vi.fn(async () => ({ data: [], meta: {} })),
  getReviewStats: vi.fn(async () => ({ totalReviews: 0 })),
}));

vi.mock('../../../src/modules/collections/collection.service', () => ({
  getOwnerId: vi.fn(async () => 'dev-user'),
  getCollectionById: vi.fn(async () => ({ id: 'ok' })),
  getCollectionByUsernameAndSlug: vi.fn(async () => ({ id: 'ok' })),
  getMyCollectionById: vi.fn(async () => ({ id: 'ok' })),
  getMyCollectionBySlug: vi.fn(async () => ({ id: 'ok' })),
  listCollectionsByUser: vi.fn(async () => ({ data: [], meta: {} })),
  listMyCollections: vi.fn(async () => ({ data: [], meta: {} })),
  followCollection: vi.fn(async () => undefined),
}));

vi.mock('../../../src/modules/users/user.service', () => ({
  getUserById: vi.fn(async () => ({ id: 'ok' })),
  getUserByUsername: vi.fn(async () => ({ id: 'ok' })),
  getMe: vi.fn(async () => ({ id: 'ok' })),
}));

vi.mock('../../../src/modules/reports/report.service', () => ({
  createRecipeReport: vi.fn(async () => ({ id: 'ok' })),
  listMyReports: vi.fn(async () => ({ data: [], meta: {} })),
}));

import recipeRouter, { userRecipesRouter } from '../../../src/modules/recipes/recipe.router';
import reviewRouter, { recipeReviewsRouter } from '../../../src/modules/reviews/review.router';
import collectionRouter, {
  userCollectionsRouter,
} from '../../../src/modules/collections/collection.router';
import userRouter from '../../../src/modules/users/user.router';
import { recipeReportsRouter } from '../../../src/modules/reports/report.router';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import * as recipeService from '../../../src/modules/recipes/recipe.service';
import * as userService from '../../../src/modules/users/user.service';
import * as collectionService from '../../../src/modules/collections/collection.service';

// Mirrors the mount order in app.ts.
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/users', userRouter);
  app.use('/users', userRecipesRouter);
  app.use('/users', userCollectionsRouter);
  app.use('/recipes', recipeRouter);
  app.use('/recipes', recipeReviewsRouter);
  app.use('/recipes', recipeReportsRouter);
  app.use('/reviews', reviewRouter);
  app.use('/collections', collectionRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const api = (): supertest.Agent => supertest(app);
const AUTH = ['x-dev-user-sub', 'dev-user'] as const;
const UUID = '01a005f1-abca-7302-8cc6-e9762dea4932';

beforeEach(() => vi.clearAllMocks());

// ─── Malformed uuid → 422, never 500 ──────────────────────────────────────────

describe('malformed uuid route params are rejected with 422', () => {
  const BAD = 'not-a-uuid';

  const publicRoutes: [string, string][] = [
    ['get', `/recipes/${BAD}`],
    ['get', `/recipes/${BAD}/reviews`],
    ['get', `/recipes/${BAD}/reviews/summary`],
    ['get', `/users/${BAD}/recipes`],
    ['get', `/users/${BAD}/collections`],
    ['get', `/users/${BAD}`],
    ['get', `/collections/${BAD}`],
  ];

  for (const [method, path] of publicRoutes) {
    it(`${method.toUpperCase()} ${path} → 422`, async () => {
      const res = await (api() as never as Record<string, (p: string) => supertest.Test>)[method](
        path,
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  }

  const authedRoutes: [string, string][] = [
    ['put', `/recipes/${BAD}`],
    ['patch', `/recipes/${BAD}`],
    ['delete', `/recipes/${BAD}`],
    ['post', `/recipes/${BAD}/cover-image`],
    ['delete', `/recipes/${BAD}/cover-image`],
    ['post', `/recipes/${BAD}/images`],
    ['delete', `/recipes/${BAD}/images`],
    ['post', `/recipes/${BAD}/reports`],
    ['post', `/reviews/${BAD}/images`],
    ['delete', `/reviews/${BAD}/images`],
    ['put', `/collections/${BAD}`],
    ['patch', `/collections/${BAD}`],
    ['delete', `/collections/${BAD}`],
    ['post', `/collections/${BAD}/recipes`],
    ['delete', `/collections/${BAD}/recipes`],
    ['post', `/collections/${BAD}/follow`],
    ['delete', `/collections/${BAD}/follow`],
    ['get', `/users/me/collections/${BAD}`],
  ];

  for (const [method, path] of authedRoutes) {
    it(`${method.toUpperCase()} ${path} → 422`, async () => {
      const res = await (api() as never as Record<string, (p: string) => supertest.Test>)
        [method](path)
        .set(...AUTH)
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  }

  it('rejects before the owner guard reaches the database', async () => {
    await api()
      .delete(`/recipes/${BAD}`)
      .set(...AUTH);
    // The guard resolves the owner via Prisma — a malformed uuid must never get that far.
    expect(recipeService.getRecipeAuthorId).not.toHaveBeenCalled();
  });
});

// ─── Well-formed uuids still pass through ─────────────────────────────────────

describe('well-formed uuid params still reach the handler', () => {
  // The trailing `undefined` is the viewer sub: optionalAuthenticate runs on this route and,
  // with no Clerk middleware mounted here, leaves req.user unset rather than rejecting.
  it('GET /recipes/:recipeId passes validation and keeps the param', async () => {
    const res = await api().get(`/recipes/${UUID}`);
    expect(res.status).toBe(200);
    expect(recipeService.getRecipeById).toHaveBeenCalledWith(UUID, undefined);
  });

  it('GET /recipes/:recipeId forwards the caller sub when a session is present', async () => {
    const res = await api()
      .get(`/recipes/${UUID}`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(recipeService.getRecipeById).toHaveBeenCalledWith(UUID, 'dev-user');
  });

  it('DELETE /recipes/:recipeId reaches the owner guard with the param intact', async () => {
    const res = await api()
      .delete(`/recipes/${UUID}`)
      .set(...AUTH);
    expect(res.status).not.toBe(422);
    expect(recipeService.getRecipeAuthorId).toHaveBeenCalledWith(UUID);
  });

  it('GET /recipes forwards undefined when no session is present', async () => {
    const res = await api().get('/recipes');
    expect(res.status).toBe(200);
    expect(recipeService.listRecipes).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it('GET /recipes forwards the caller sub when a session is present', async () => {
    const res = await api()
      .get('/recipes')
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(recipeService.listRecipes).toHaveBeenCalledWith(expect.anything(), 'dev-user');
  });

  it('GET /users/:userId/recipes forwards undefined when no session is present', async () => {
    const res = await api().get(`/users/${UUID}/recipes`);
    expect(res.status).toBe(200);
    expect(recipeService.listRecipesByUser).toHaveBeenCalledWith(
      UUID,
      expect.anything(),
      undefined,
    );
  });

  it('GET /users/:userId/recipes forwards the caller sub when a session is present', async () => {
    const res = await api()
      .get(`/users/${UUID}/recipes`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(recipeService.listRecipesByUser).toHaveBeenCalledWith(
      UUID,
      expect.anything(),
      'dev-user',
    );
  });

  // The two public profile/collection reads run no auth middleware at all: a session must not
  // reach the service, so it can't change the answer. Their owner-scoped counterparts are
  // GET /users/me and GET /users/me/collections[/:collectionId].
  it('GET /users/:userId passes only the id, with or without a session', async () => {
    expect((await api().get(`/users/${UUID}`)).status).toBe(200);
    expect(userService.getUserById).toHaveBeenCalledWith(UUID);

    await api()
      .get(`/users/${UUID}`)
      .set(...AUTH);
    expect(userService.getUserById).toHaveBeenLastCalledWith(UUID);
  });

  it('GET /users/:userId/collections passes no caller, with or without a session', async () => {
    expect((await api().get(`/users/${UUID}/collections`)).status).toBe(200);
    expect(collectionService.listCollectionsByUser).toHaveBeenCalledWith(UUID, expect.anything());

    await api()
      .get(`/users/${UUID}/collections`)
      .set(...AUTH);
    expect(collectionService.listCollectionsByUser).toHaveBeenLastCalledWith(
      UUID,
      expect.anything(),
    );
  });

  it('GET /users/me/collections/:collectionId keeps the param and takes the sub from the session', async () => {
    const res = await api()
      .get(`/users/me/collections/${UUID}`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(collectionService.getMyCollectionById).toHaveBeenCalledWith(UUID, 'dev-user');
    // The :userId wildcard on the sibling route must not swallow the literal "me" segment.
    expect(collectionService.listCollectionsByUser).not.toHaveBeenCalled();
  });
});

// ─── Route-ordering and param-stripping regressions ───────────────────────────

describe('non-uuid routes are unaffected', () => {
  // `validate` replaces req.params with the parsed object and Zod strips unknown keys —
  // a params schema on this route would silently drop one of the two values.
  it('GET /users/:username/recipes/:recipename keeps both string params', async () => {
    const res = await api().get('/users/joao/recipes/pasta-carbonara');
    expect(res.status).toBe(200);
    expect(recipeService.getRecipeByUsernameAndSlug).toHaveBeenCalledWith(
      'joao',
      'pasta-carbonara',
      undefined,
    );
  });

  // Same reasoning as the recipe route above: two plain-string params, so no params schema —
  // one covering only `username` would strip `slug` on the way through.
  it('GET /users/:username/collections/:slug keeps both string params', async () => {
    const res = await api().get('/users/joao/collections/weeknight-dinners');
    expect(res.status).toBe(200);
    expect(collectionService.getCollectionByUsernameAndSlug).toHaveBeenCalledWith(
      'joao',
      'weeknight-dinners',
    );
    // The uuid guard on the sibling /:userId/collections route must not reject it.
    expect(collectionService.listCollectionsByUser).not.toHaveBeenCalled();
  });

  it('GET /users/username/:username is not shadowed by the /:userId uuid guard', async () => {
    const res = await api().get('/users/username/joao');
    expect(res.status).toBe(200);
    // Public: no auth middleware, so the username is all the service ever receives.
    expect(userService.getUserByUsername).toHaveBeenCalledWith('joao');
  });

  // One plain-string param, so no params schema — and at four segments neither the
  // /me/collections/:collectionId uuid guard nor the /:userId one can claim it first.
  it('GET /users/me/collections/slug/:slug keeps the slug and takes the sub from the session', async () => {
    const res = await api()
      .get('/users/me/collections/slug/weeknight-dinners')
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(collectionService.getMyCollectionBySlug).toHaveBeenCalledWith(
      'weeknight-dinners',
      'dev-user',
    );
    expect(collectionService.getMyCollectionById).not.toHaveBeenCalled();
    expect(collectionService.listCollectionsByUser).not.toHaveBeenCalled();
  });

  it('GET /users/me/collections is not swallowed by the :userId uuid guard', async () => {
    const res = await api()
      .get('/users/me/collections')
      .set(...AUTH);
    expect(res.status).toBe(200);
  });

  it('GET /users/me still resolves to the profile route', async () => {
    // /users/me would otherwise fall through to GET /:userId and 422 on the uuid check.
    const res = await api()
      .get('/users/me')
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(userService.getUserById).not.toHaveBeenCalled();
  });
});
