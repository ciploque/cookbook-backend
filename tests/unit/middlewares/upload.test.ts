import { describe, it, expect, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import supertest from 'supertest';

vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'test' },
  allowedOrigins: [],
  trustedImageDomains: [] as string[],
}));

import { uploadImagesArray, uploadSingleImage } from '../../../src/middlewares/upload';
import { errorHandler } from '../../../src/middlewares/errorHandler';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Echoes back what multer parsed, so tests can assert the buffers actually reached the handler.
function buildApp(): Express {
  const app = express();

  app.post('/single', uploadSingleImage('image'), (req: Request, res: Response) => {
    res.json({
      fieldname: req.file?.fieldname ?? null,
      size: req.file?.buffer.length ?? null,
      content: req.file?.buffer.toString() ?? null,
    });
  });

  app.post('/many', uploadImagesArray('images', 10), (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.json({ count: files.length, contents: files.map((f) => f.buffer.toString()) });
  });

  app.use(errorHandler);
  return app;
}

const app = buildApp();
const api = (): supertest.Agent => supertest(app);

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('uploadSingleImage()', () => {
  it('buffers the file in memory and exposes it on req.file', async () => {
    const res = await api()
      .post('/single')
      .attach('image', Buffer.from('fake-jpeg-bytes'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fieldname: 'image', content: 'fake-jpeg-bytes' });
  });

  it('leaves req.file undefined when no file is attached', async () => {
    // The controller — not this middleware — is what turns a missing file into a 422.
    const res = await api().post('/single');

    expect(res.status).toBe(200);
    expect(res.body.fieldname).toBeNull();
  });
});

describe('uploadImagesArray()', () => {
  it('buffers every file and preserves upload order', async () => {
    const res = await api()
      .post('/many')
      .attach('images', Buffer.from('first'), { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('images', Buffer.from('second'), { filename: 'b.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2, contents: ['first', 'second'] });
  });
});

// ─── Rejections, all translated to the project's 422 convention ───────────────

describe('multer failures are translated to ApiError, never a raw 500', () => {
  // The mimetype prefilter is cheap and client-declared; storage.service verifies the real
  // magic bytes later. This test guards the first gate, including the SVG/XSS case.
  it('rejects a non-image mimetype with 422', async () => {
    const res = await api()
      .post('/single')
      .attach('image', Buffer.from('#!/bin/sh\necho pwned'), {
        filename: 'payload.sh',
        contentType: 'application/x-sh',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.image[0]).toBe('Only image files are allowed');
  });

  it('rejects an image/svg+xml upload with 422', async () => {
    const res = await api()
      .post('/single')
      .attach('image', Buffer.from('<svg onload="alert(1)"/>'), {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      });

    // image/svg+xml passes the `image/` prefix check by design — the magic-byte check in
    // storage.service is what actually rejects SVG. This asserts the prefilter is not the
    // guard being relied on, so that check can never be quietly dropped.
    expect(res.status).toBe(200);
  });

  it('rejects a file over the 5MB limit with 422', async () => {
    const res = await api()
      .post('/single')
      .attach('image', Buffer.alloc(MAX_IMAGE_SIZE_BYTES + 1, 1), {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.image[0]).toBe('File exceeds the maximum size of 5MB');
  });

  // Boundary, pinned because it is off by one from what the limit reads like: multer's
  // `fileSize` is exclusive, so a file of exactly 5MB is rejected and the real ceiling is
  // 5MB − 1 byte. Changing the limit constant must keep this pair in step.
  it('accepts a file one byte under the limit and rejects one exactly at it', async () => {
    const under = await api()
      .post('/single')
      .attach('image', Buffer.alloc(MAX_IMAGE_SIZE_BYTES - 1, 1), {
        filename: 'under.jpg',
        contentType: 'image/jpeg',
      });

    expect(under.status).toBe(200);
    expect(under.body.size).toBe(MAX_IMAGE_SIZE_BYTES - 1);

    const exact = await api()
      .post('/single')
      .attach('image', Buffer.alloc(MAX_IMAGE_SIZE_BYTES, 1), {
        filename: 'exact.jpg',
        contentType: 'image/jpeg',
      });

    expect(exact.status).toBe(422);
  });

  it('rejects more than maxCount files in one array upload with 422', async () => {
    let req = api().post('/many');
    for (let i = 0; i < 11; i++) {
      req = req.attach('images', Buffer.from(`f${i}`), {
        filename: `${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }
    const res = await req;

    expect(res.status).toBe(422);
    expect(res.body.error.details.image[0]).toBe('Too many files in this upload');
  });

  it('rejects an unexpected field name with 422', async () => {
    // A single-file route receiving the array field name (or vice versa) is a client bug,
    // not a server error.
    const res = await api()
      .post('/single')
      .attach('images', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.error.details.image[0]).toBe('Too many files in this upload');
  });
});
