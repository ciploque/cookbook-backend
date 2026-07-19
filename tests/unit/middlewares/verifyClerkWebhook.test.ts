import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('@clerk/express/webhooks', () => ({
  verifyWebhook: vi.fn(),
}));

import { verifyWebhook } from '@clerk/express/webhooks';
import { verifyClerkWebhook } from '../../../src/middlewares/verifyClerkWebhook';

function makeReq(): Request {
  return {} as unknown as Request;
}

const res = {} as Response;

beforeEach(() => vi.clearAllMocks());

describe('verifyClerkWebhook', () => {
  it('attaches the verified event to req.clerkEvent and calls next() on success', async () => {
    const event = { type: 'user.created', data: { id: 'user_1' } };
    vi.mocked(verifyWebhook).mockResolvedValue(event as never);
    const req = makeReq();
    const next = vi.fn() as unknown as NextFunction;

    await verifyClerkWebhook(req, res, next);

    expect(req.clerkEvent).toEqual(event);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next with a 400 ApiError when signature verification fails', async () => {
    vi.mocked(verifyWebhook).mockRejectedValue(new Error('Invalid signature'));
    const req = makeReq();
    const next = vi.fn() as unknown as NextFunction;

    await verifyClerkWebhook(req, res, next);

    expect(req.clerkEvent).toBeUndefined();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_WEBHOOK_SIGNATURE' }),
    );
  });
});
