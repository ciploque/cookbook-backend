import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Express } from 'express';
import supertest from 'supertest';

// Real review routers on a bare Express app with the service mocked — pins the HTTP
// contract: status codes, response envelope, and what each controller forwards.
vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'development' },
  allowedOrigins: [],
  trustedImageDomains: [] as string[],
}));

vi.mock('../../../src/config/database', () => ({ prisma: {} }));

vi.mock('../../../src/modules/reviews/review.service', () => ({
  getReviewAuthorId: vi.fn(async () => 'user_author'),
  listReviewsByRecipe: vi.fn(),
  createReview: vi.fn(),
  getMyReviewForRecipe: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
  getReviewStats: vi.fn(),
  addReviewImages: vi.fn(),
  removeReviewImages: vi.fn(),
}));

import reviewRouter, { recipeReviewsRouter } from '../../../src/modules/reviews/review.router';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import * as reviewService from '../../../src/modules/reviews/review.service';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/reviews', reviewRouter);
  app.use('/recipes', recipeReviewsRouter);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const api = (): supertest.Agent => supertest(app);
const AUTH = ['x-dev-user-sub', 'user_author'] as const;
const RECIPE_ID = '01a005f1-abca-7302-8cc6-e9762dea4932';
const REVIEW_ID = '01a005f1-abca-7302-8cc6-e9762dea4933';

const review = { id: REVIEW_ID, recipeId: RECIPE_ID, rating: 4, content: 'Great', imageUrls: [] };
const meta = { page: 1, limit: 20, total: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reviewService.getReviewAuthorId).mockResolvedValue('user_author');
});

// ─── Reads ────────────────────────────────────────────────────────────────────

describe('GET /recipes/:recipeId/reviews', () => {
  it('returns the paginated envelope with meta beside data', async () => {
    vi.mocked(reviewService.listReviewsByRecipe).mockResolvedValue({
      data: [review],
      meta,
    } as never);

    const res = await api().get(`/recipes/${RECIPE_ID}/reviews`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [review], meta });
  });

  it('forwards the filter and order query params', async () => {
    vi.mocked(reviewService.listReviewsByRecipe).mockResolvedValue({ data: [], meta } as never);

    await api().get(`/recipes/${RECIPE_ID}/reviews?filter=media&order=rating_desc`);

    expect(reviewService.listReviewsByRecipe).toHaveBeenCalledWith(
      RECIPE_ID,
      expect.objectContaining({ filter: 'media', order: 'rating_desc' }),
    );
  });

  it('rejects an unsupported filter value with 422', async () => {
    const res = await api().get(`/recipes/${RECIPE_ID}/reviews?filter=rating:9`);

    expect(res.status).toBe(422);
    expect(reviewService.listReviewsByRecipe).not.toHaveBeenCalled();
  });
});

describe('GET /recipes/:recipeId/reviews/summary', () => {
  it('returns the stats block in a data envelope', async () => {
    const stats = { totalReviews: 42, ratingCounts: { 5: 24 }, mediaCount: 14 };
    vi.mocked(reviewService.getReviewStats).mockResolvedValue(stats as never);

    const res = await api().get(`/recipes/${RECIPE_ID}/reviews/summary`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: stats });
  });

  it('is not shadowed by the /:recipeId/reviews list route', async () => {
    vi.mocked(reviewService.getReviewStats).mockResolvedValue({ totalReviews: 0 } as never);

    await api().get(`/recipes/${RECIPE_ID}/reviews/summary`);

    expect(reviewService.getReviewStats).toHaveBeenCalled();
    expect(reviewService.listReviewsByRecipe).not.toHaveBeenCalled();
  });
});

describe('GET /recipes/:recipeId/reviews/me', () => {
  it('resolves the caller from the session, not the path', async () => {
    vi.mocked(reviewService.getMyReviewForRecipe).mockResolvedValue(review as never);

    const res = await api()
      .get(`/recipes/${RECIPE_ID}/reviews/me`)
      .set(...AUTH);

    expect(res.status).toBe(200);
    expect(reviewService.getMyReviewForRecipe).toHaveBeenCalledWith('user_author', RECIPE_ID);
  });

  it('requires authentication — unlike its two sibling reads', async () => {
    const res = await api().get(`/recipes/${RECIPE_ID}/reviews/me`);

    expect(res.status).toBe(401);
    expect(reviewService.getMyReviewForRecipe).not.toHaveBeenCalled();
  });
});

// ─── Writes ───────────────────────────────────────────────────────────────────

describe('POST /reviews', () => {
  it('returns 201 and takes the author from the session', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue(review as never);

    const res = await api()
      .post('/reviews')
      .set(...AUTH)
      .send({ recipeId: RECIPE_ID, rating: 4, content: 'Great' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: review });
    expect(reviewService.createReview).toHaveBeenCalledWith('user_author', {
      recipeId: RECIPE_ID,
      rating: 4,
      content: 'Great',
    });
  });

  it('strips a client-supplied imageUrls — images are server-managed', async () => {
    vi.mocked(reviewService.createReview).mockResolvedValue(review as never);

    await api()
      .post('/reviews')
      .set(...AUTH)
      .send({ recipeId: RECIPE_ID, rating: 4, imageUrls: ['https://evil.example/x.jpg'] });

    expect(reviewService.createReview).toHaveBeenCalledWith(
      'user_author',
      expect.not.objectContaining({ imageUrls: expect.anything() }),
    );
  });

  it('rejects a rating outside 1–5 with 422', async () => {
    const res = await api()
      .post('/reviews')
      .set(...AUTH)
      .send({ recipeId: RECIPE_ID, rating: 6 });

    expect(res.status).toBe(422);
    expect(reviewService.createReview).not.toHaveBeenCalled();
  });

  it('surfaces the duplicate-review conflict as 409', async () => {
    const { ApiError } = await import('../../../src/utils/ApiError');
    vi.mocked(reviewService.createReview).mockRejectedValue(
      ApiError.conflict('You have already reviewed this recipe'),
    );

    const res = await api()
      .post('/reviews')
      .set(...AUTH)
      .send({ recipeId: RECIPE_ID, rating: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('PUT /reviews/:reviewId', () => {
  it('forwards the path id and the full-replace body', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue(review as never);

    const res = await api()
      .put(`/reviews/${REVIEW_ID}`)
      .set(...AUTH)
      .send({ rating: 5, content: 'Even better' });

    expect(res.status).toBe(200);
    expect(reviewService.updateReview).toHaveBeenCalledWith(REVIEW_ID, {
      rating: 5,
      content: 'Even better',
    });
  });

  it('strips recipeId so a review cannot be moved between recipes', async () => {
    vi.mocked(reviewService.updateReview).mockResolvedValue(review as never);

    await api()
      .put(`/reviews/${REVIEW_ID}`)
      .set(...AUTH)
      .send({ rating: 5, recipeId: '01a005f1-abca-7302-8cc6-e9762dea4999' });

    expect(reviewService.updateReview).toHaveBeenCalledWith(REVIEW_ID, { rating: 5 });
  });

  it('returns 403 without calling the service when the caller is not the author', async () => {
    vi.mocked(reviewService.getReviewAuthorId).mockResolvedValue('someone-else');

    const res = await api()
      .put(`/reviews/${REVIEW_ID}`)
      .set('x-dev-user-sub', 'user_intruder')
      .send({ rating: 1 });

    expect(res.status).toBe(403);
    expect(reviewService.updateReview).not.toHaveBeenCalled();
  });
});

describe('DELETE /reviews/:reviewId', () => {
  it('returns 204 with an empty body', async () => {
    vi.mocked(reviewService.deleteReview).mockResolvedValue(undefined);

    const res = await api()
      .delete(`/reviews/${REVIEW_ID}`)
      .set(...AUTH);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(reviewService.deleteReview).toHaveBeenCalledWith(REVIEW_ID);
  });
});

// ─── Image endpoints ──────────────────────────────────────────────────────────

describe('POST /reviews/:reviewId/images', () => {
  it('passes every uploaded buffer, in order', async () => {
    vi.mocked(reviewService.addReviewImages).mockResolvedValue(review as never);

    const res = await api()
      .post(`/reviews/${REVIEW_ID}/images`)
      .set(...AUTH)
      .attach('images', Buffer.from('one'), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('images', Buffer.from('two'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(reviewService.addReviewImages).toHaveBeenCalledWith(REVIEW_ID, [
      Buffer.from('one'),
      Buffer.from('two'),
    ]);
  });

  it('returns 422 when no files are attached', async () => {
    const res = await api()
      .post(`/reviews/${REVIEW_ID}/images`)
      .set(...AUTH);

    expect(res.status).toBe(422);
    expect(res.body.error.details.images[0]).toBe('No image files were provided');
    expect(reviewService.addReviewImages).not.toHaveBeenCalled();
  });
});

describe('DELETE /reviews/:reviewId/images', () => {
  it('forwards the paths array from the body', async () => {
    vi.mocked(reviewService.removeReviewImages).mockResolvedValue(review as never);

    const res = await api()
      .delete(`/reviews/${REVIEW_ID}/images`)
      .set(...AUTH)
      .send({ paths: [`/reviews/${REVIEW_ID}/gallery/a.jpg`] });

    expect(res.status).toBe(200);
    expect(reviewService.removeReviewImages).toHaveBeenCalledWith(REVIEW_ID, [
      `/reviews/${REVIEW_ID}/gallery/a.jpg`,
    ]);
  });
});
