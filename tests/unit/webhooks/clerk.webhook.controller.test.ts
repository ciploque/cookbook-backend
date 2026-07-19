import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

vi.mock('../../../src/modules/users/user.service', () => ({
  provisionFromWebhook: vi.fn(),
  deleteUserByAuthProviderId: vi.fn(),
}));

import * as userService from '../../../src/modules/users/user.service';
import { handleClerkWebhook } from '../../../src/modules/webhooks/clerk.webhook.controller';

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(clerkEvent: unknown): Request {
  return {
    clerkEvent,
    log: { info: vi.fn(), debug: vi.fn() },
  } as unknown as Request;
}

beforeEach(() => vi.clearAllMocks());

describe('handleClerkWebhook', () => {
  it('provisions a stub user on user.created, using the primary email address', async () => {
    const event = {
      type: 'user.created',
      data: {
        id: 'user_1',
        username: 'joao',
        first_name: 'João',
        last_name: 'Lima',
        image_url: 'https://img.clerk.com/joao.png',
        primary_email_address_id: 'idn_2',
        email_addresses: [
          { id: 'idn_1', email_address: 'secondary@example.com' },
          { id: 'idn_2', email_address: 'primary@example.com' },
        ],
      },
    };
    const req = makeReq(event);
    const res = makeRes();

    await handleClerkWebhook(req, res);

    expect(userService.provisionFromWebhook).toHaveBeenCalledWith({
      id: 'user_1',
      username: 'joao',
      emailAddress: 'primary@example.com',
      firstName: 'João',
      lastName: 'Lima',
      imageUrl: 'https://img.clerk.com/joao.png',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('falls back to the first email address when no primary email is set', async () => {
    const event = {
      type: 'user.created',
      data: {
        id: 'user_1',
        username: null,
        first_name: null,
        last_name: null,
        image_url: null,
        primary_email_address_id: null,
        email_addresses: [{ id: 'idn_1', email_address: 'only@example.com' }],
      },
    };
    const req = makeReq(event);
    const res = makeRes();

    await handleClerkWebhook(req, res);

    const callArg = vi.mocked(userService.provisionFromWebhook).mock.calls[0][0];
    expect(callArg.emailAddress).toBe('only@example.com');
  });

  it('deletes the user on user.deleted', async () => {
    const event = { type: 'user.deleted', data: { id: 'user_1', deleted: true } };
    const req = makeReq(event);
    const res = makeRes();

    await handleClerkWebhook(req, res);

    expect(userService.deleteUserByAuthProviderId).toHaveBeenCalledWith('user_1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not call delete when user.deleted has no id', async () => {
    const event = { type: 'user.deleted', data: { deleted: true } };
    const req = makeReq(event);
    const res = makeRes();

    await handleClerkWebhook(req, res);

    expect(userService.deleteUserByAuthProviderId).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('is a no-op on user.updated (logs only)', async () => {
    const event = { type: 'user.updated', data: { id: 'user_1' } };
    const req = makeReq(event);
    const res = makeRes();

    await handleClerkWebhook(req, res);

    expect(userService.provisionFromWebhook).not.toHaveBeenCalled();
    expect(userService.deleteUserByAuthProviderId).not.toHaveBeenCalled();
    expect(req.log.info).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('ignores unhandled event types and still responds 200', async () => {
    const event = { type: 'session.created', data: { id: 'sess_1' } };
    const req = makeReq(event);
    const res = makeRes();

    await handleClerkWebhook(req, res);

    expect(userService.provisionFromWebhook).not.toHaveBeenCalled();
    expect(userService.deleteUserByAuthProviderId).not.toHaveBeenCalled();
    expect(req.log.debug).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
