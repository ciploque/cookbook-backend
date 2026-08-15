import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../../src/config/env', () => ({ env: { NODE_ENV: 'production' } }));

import { errorHandler } from '../../../src/middlewares/errorHandler';
import { ApiError } from '../../../src/utils/ApiError';

function mockRes() {
  const res = {} as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('errorHandler()', () => {
  it('passes an ApiError through with its status, code and details', () => {
    const res = mockRes();
    errorHandler(ApiError.conflict('dup'), {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'CONFLICT', message: 'dup' }),
      }),
    );
  });

  it('maps a body-parser entity.too.large error to 413 PAYLOAD_TOO_LARGE', () => {
    const res = mockRes();
    errorHandler({ type: 'entity.too.large' }, {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }) }),
    );
  });

  it('maps a body-parser entity.parse.failed error to 400 INVALID_JSON', () => {
    const res = mockRes();
    errorHandler({ type: 'entity.parse.failed' }, {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_JSON' }) }),
    );
  });

  it('maps an unknown error to a generic 500 without leaking the message in production', () => {
    const res = mockRes();
    errorHandler(new Error('boom secret internals'), {} as Request, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
      }),
    );
  });
});
