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
  listPublicCollectionsByUser: vi.fn(async () => ({ data: [], meta: {} })),
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
    await api().delete(`/recipes/${BAD}`).set(...AUTH);
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

  it('GET /users/username/:username is not shadowed by the /:userId uuid guard', async () => {
    const res = await api().get('/users/username/joao');
    expect(res.status).toBe(200);
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
