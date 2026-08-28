import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import supertest from 'supertest';

// The real recipe routers are mounted on a bare Express app (no helmet/cors/clerk) with the
// service layer mocked, so these tests pin the HTTP contract the frontend depends on:
// status codes, the { success, data } / { success, data, meta } envelope, and which values
// each controller forwards into the service.
vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'development' },
  allowedOrigins: [],
  trustedImageDomains: [] as string[],
}));

vi.mock('../../../src/config/database', () => ({ prisma: {} }));

vi.mock('../../../src/modules/recipes/recipe.service', () => ({
  getRecipeAuthorId: vi.fn(async () => 'user_author'),
  listRecipes: vi.fn(),
  listRecipesByUser: vi.fn(),
  getRecipeById: vi.fn(),
  getRecipeByUsernameAndSlug: vi.fn(),
  createRecipe: vi.fn(),
  updateRecipe: vi.fn(),
  patchRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  uploadCoverImage: vi.fn(),
  deleteCoverImage: vi.fn(),
  addGalleryImages: vi.fn(),
  removeGalleryImages: vi.fn(),
}));

import recipeRouter, { userRecipesRouter } from '../../../src/modules/recipes/recipe.router';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import * as recipeService from '../../../src/modules/recipes/recipe.service';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/recipes', recipeRouter);
  app.use('/users', userRecipesRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const api = (): supertest.Agent => supertest(app);
const AUTH = ['x-dev-user-sub', 'user_author'] as const;
const UUID = '01a005f1-abca-7302-8cc6-e9762dea4932';

const recipe = { id: UUID, slug: 'pasta-carbonara', title: 'Pasta Carbonara', tags: ['italian'] };
const meta = {
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPrevPage: false,
};
const validBody = { title: 'Pasta Carbonara', tags: ['italian'], ingredients: [], steps: [] };
const jpeg = (name = 'a.jpg'): [Buffer, { filename: string; contentType: string }] => [
  Buffer.from(`bytes-of-${name}`),
  { filename: name, contentType: 'image/jpeg' },
];

beforeEach(() => {
  vi.clearAllMocks();
  // Re-armed per test: the not-the-author case below overrides it with a persistent value.
  vi.mocked(recipeService.getRecipeAuthorId).mockResolvedValue('user_author');
});

// ─── Reads ────────────────────────────────────────────────────────────────────

describe('GET /recipes', () => {
  it('spreads data and meta at the top level of the envelope', async () => {
    vi.mocked(recipeService.listRecipes).mockResolvedValue({ data: [recipe], meta } as never);

    const res = await api().get('/recipes');

    expect(res.status).toBe(200);
    // meta must sit beside data, not nested inside it — the paginated envelope contract.
    expect(res.body).toEqual({ success: true, data: [recipe], meta });
  });

  it('forwards the parsed query with defaults applied', async () => {
    vi.mocked(recipeService.listRecipes).mockResolvedValue({ data: [], meta } as never);

    await api().get('/recipes?q=carbonara&tags=italian,pasta&minRating=4');

    expect(recipeService.listRecipes).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'carbonara',
        tags: 'italian,pasta',
        minRating: 4, // coerced from the query string, not left as "4"
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        order: 'desc',
      }),
      undefined,
    );
  });
});

describe('GET /recipes/:recipeId', () => {
  it('returns the recipe in a data envelope', async () => {
    vi.mocked(recipeService.getRecipeById).mockResolvedValue(recipe as never);

    const res = await api().get(`/recipes/${UUID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: recipe });
  });

  it('surfaces a service 404 as the error envelope, not a 500', async () => {
    const { ApiError } = await import('../../../src/utils/ApiError');
    vi.mocked(recipeService.getRecipeById).mockRejectedValue(ApiError.notFound('Recipe'));

    const res = await api().get(`/recipes/${UUID}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'RECIPE_NOT_FOUND' } });
  });
});

describe('GET /users/:username/recipes/:recipename', () => {
  it('forwards both path segments and the viewer sub', async () => {
    vi.mocked(recipeService.getRecipeByUsernameAndSlug).mockResolvedValue(recipe as never);

    const res = await api()
      .get('/users/joao/recipes/pasta-carbonara')
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(recipeService.getRecipeByUsernameAndSlug).toHaveBeenCalledWith(
      'joao',
      'pasta-carbonara',
      'user_author',
    );
  });
});

describe('GET /users/:userId/recipes', () => {
  it('forwards the path user id alongside the parsed query', async () => {
    vi.mocked(recipeService.listRecipesByUser).mockResolvedValue({ data: [], meta } as never);

    const res = await api().get(`/users/${UUID}/recipes?page=2`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], meta });
    expect(recipeService.listRecipesByUser).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ page: 2 }),
      undefined,
    );
  });
});

// ─── Writes ───────────────────────────────────────────────────────────────────

describe('POST /recipes', () => {
  it('returns 201 and passes the caller sub as the author', async () => {
    vi.mocked(recipeService.createRecipe).mockResolvedValue(recipe as never);

    const res = await api()
      .post('/recipes')
      .set(...AUTH)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: recipe });
    // The author comes from the session, never from the body.
    expect(recipeService.createRecipe).toHaveBeenCalledWith(
      'user_author',
      expect.objectContaining({ title: 'Pasta Carbonara' }),
    );
  });

  it('rejects an unauthenticated create with 401 before reaching the service', async () => {
    const res = await api().post('/recipes').send(validBody);

    expect(res.status).toBe(401);
    expect(recipeService.createRecipe).not.toHaveBeenCalled();
  });

  it('strips server-managed image fields out of the body before the service sees them', async () => {
    vi.mocked(recipeService.createRecipe).mockResolvedValue(recipe as never);

    await api()
      .post('/recipes')
      .set(...AUTH)
      .send({ ...validBody, coverImageUrl: '/attacker/owned.jpg', imageUrls: ['/attacker/x.jpg'] });

    const body = vi.mocked(recipeService.createRecipe).mock.calls[0][1];
    expect(body).not.toHaveProperty('coverImageUrl');
    expect(body).not.toHaveProperty('imageUrls');
  });
});

describe('PUT / PATCH /recipes/:recipeId', () => {
  it('PUT returns the updated recipe with the path id', async () => {
    vi.mocked(recipeService.updateRecipe).mockResolvedValue(recipe as never);

    const res = await api()
      .put(`/recipes/${UUID}`)
      .set(...AUTH)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: recipe });
    expect(recipeService.updateRecipe).toHaveBeenCalledWith(
      UUID,
      expect.objectContaining({ title: 'Pasta Carbonara' }),
    );
  });

  it('PUT rejects a body missing the required title with 422', async () => {
    const res = await api()
      .put(`/recipes/${UUID}`)
      .set(...AUTH)
      .send({ tags: [] });

    expect(res.status).toBe(422);
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
  });

  it('PATCH accepts a partial body', async () => {
    vi.mocked(recipeService.patchRecipe).mockResolvedValue(recipe as never);

    const res = await api()
      .patch(`/recipes/${UUID}`)
      .set(...AUTH)
      .send({ title: 'Renamed' });

    expect(res.status).toBe(200);
    expect(recipeService.patchRecipe).toHaveBeenCalledWith(UUID, { title: 'Renamed' });
  });

  it('returns 403 without calling the service when the caller is not the author', async () => {
    vi.mocked(recipeService.getRecipeAuthorId).mockResolvedValue('someone-else');

    const res = await api()
      .put(`/recipes/${UUID}`)
      .set('x-dev-user-sub', 'user_intruder')
      .send(validBody);

    expect(res.status).toBe(403);
    expect(recipeService.updateRecipe).not.toHaveBeenCalled();
  });
});

describe('DELETE /recipes/:recipeId', () => {
  it('returns 204 with an empty body', async () => {
    vi.mocked(recipeService.deleteRecipe).mockResolvedValue(undefined);

    const res = await api()
      .delete(`/recipes/${UUID}`)
      .set(...AUTH);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');
    expect(recipeService.deleteRecipe).toHaveBeenCalledWith(UUID);
  });
});

// ─── Image endpoints ──────────────────────────────────────────────────────────

describe('POST /recipes/:recipeId/cover-image', () => {
  it('passes the uploaded buffer to the service', async () => {
    vi.mocked(recipeService.uploadCoverImage).mockResolvedValue(recipe as never);

    const res = await api()
      .post(`/recipes/${UUID}/cover-image`)
      .set(...AUTH)
      .attach('image', ...jpeg('cover.jpg'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: recipe });
    expect(recipeService.uploadCoverImage).toHaveBeenCalledWith(
      UUID,
      Buffer.from('bytes-of-cover.jpg'),
    );
  });

  // multer leaves req.file undefined rather than erroring — the controller is the only
  // thing standing between that and a TypeError deep in the service.
  it('returns 422 when no file is attached', async () => {
    const res = await api()
      .post(`/recipes/${UUID}/cover-image`)
      .set(...AUTH);

    expect(res.status).toBe(422);
    expect(res.body.error.details.image[0]).toBe('No image file was provided');
    expect(recipeService.uploadCoverImage).not.toHaveBeenCalled();
  });
});

describe('DELETE /recipes/:recipeId/cover-image', () => {
  it('returns the recipe with the cover cleared', async () => {
    vi.mocked(recipeService.deleteCoverImage).mockResolvedValue(recipe as never);

    const res = await api()
      .delete(`/recipes/${UUID}/cover-image`)
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(recipeService.deleteCoverImage).toHaveBeenCalledWith(UUID);
  });
});

describe('POST /recipes/:recipeId/images', () => {
  it('passes every uploaded buffer, in order', async () => {
    vi.mocked(recipeService.addGalleryImages).mockResolvedValue(recipe as never);

    const res = await api()
      .post(`/recipes/${UUID}/images`)
      .set(...AUTH)
      .attach('images', ...jpeg('one.jpg'))
      .attach('images', ...jpeg('two.jpg'));

    expect(res.status).toBe(200);
    expect(recipeService.addGalleryImages).toHaveBeenCalledWith(UUID, [
      Buffer.from('bytes-of-one.jpg'),
      Buffer.from('bytes-of-two.jpg'),
    ]);
  });

  it('returns 422 when no files are attached', async () => {
    const res = await api()
      .post(`/recipes/${UUID}/images`)
      .set(...AUTH);

    expect(res.status).toBe(422);
    expect(res.body.error.details.images[0]).toBe('No image files were provided');
    expect(recipeService.addGalleryImages).not.toHaveBeenCalled();
  });
});

describe('DELETE /recipes/:recipeId/images', () => {
  it('forwards the paths array from the body', async () => {
    vi.mocked(recipeService.removeGalleryImages).mockResolvedValue(recipe as never);

    const res = await api()
      .delete(`/recipes/${UUID}/images`)
      .set(...AUTH)
      .send({ paths: [`/recipes/${UUID}/gallery/a.jpg`] });

    expect(res.status).toBe(200);
    expect(recipeService.removeGalleryImages).toHaveBeenCalledWith(UUID, [
      `/recipes/${UUID}/gallery/a.jpg`,
    ]);
  });

  it('rejects an empty paths array with 422', async () => {
    const res = await api()
      .delete(`/recipes/${UUID}/images`)
      .set(...AUTH)
      .send({ paths: [] });

    expect(res.status).toBe(422);
    expect(recipeService.removeGalleryImages).not.toHaveBeenCalled();
  });
});
