import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { authorize } from '../../../src/middlewares/authorize';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    ...overrides,
  } as unknown as Request;
}

const res = {} as Response;

describe('authorize()', () => {
  it('calls next(UNAUTHORIZED) when req.user is not set', async () => {
    const getResourceOwnerId = vi.fn();
    const req = makeReq({ user: undefined });
    const next = vi.fn() as unknown as NextFunction;

    await authorize(getResourceOwnerId)(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(getResourceOwnerId).not.toHaveBeenCalled();
  });

  it('calls next(NOT_FOUND) when the resource owner lookup resolves null', async () => {
    const getResourceOwnerId = vi.fn().mockResolvedValue(null);
    const req = makeReq({ user: { sub: 'user_1' } });
    const next = vi.fn() as unknown as NextFunction;

    await authorize(getResourceOwnerId)(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('calls next(FORBIDDEN) when req.user.sub does not match the owner id', async () => {
    const getResourceOwnerId = vi.fn().mockResolvedValue('user_owner');
    const req = makeReq({ user: { sub: 'user_other' } });
    const next = vi.fn() as unknown as NextFunction;

    await authorize(getResourceOwnerId)(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('calls next() with no error when req.user.sub matches the owner id', async () => {
    const getResourceOwnerId = vi.fn().mockResolvedValue('user_owner');
    const req = makeReq({ user: { sub: 'user_owner' } });
    const next = vi.fn() as unknown as NextFunction;

    await authorize(getResourceOwnerId)(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('propagates an unexpected error from the owner lookup instead of mapping it to 404', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    const getResourceOwnerId = vi.fn().mockRejectedValue(dbError);
    const req = makeReq({ user: { sub: 'user_1' } });
    const next = vi.fn() as unknown as NextFunction;

    await expect(authorize(getResourceOwnerId)(req, res, next)).rejects.toThrow(dbError);
  });
});
