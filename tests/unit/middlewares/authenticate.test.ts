import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'development' },
}));

vi.mock('@clerk/express', () => ({
  getAuth: vi.fn(),
}));

import { getAuth } from '@clerk/express';
import { authenticate, optionalAuthenticate } from '../../../src/middlewares/authenticate';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    user: undefined,
    ...overrides,
  } as unknown as Request;
}

const res = {} as Response;

beforeEach(() => vi.clearAllMocks());

// ─── Dev bypass ───────────────────────────────────────────────────────────────

describe('dev bypass (NODE_ENV=development)', () => {
  it('sets req.user from x-dev-user-sub header and calls next()', () => {
    const req = makeReq({ headers: { 'x-dev-user-sub': 'user-123' } });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(req.user).toEqual({ sub: 'user-123' });
    expect(next).toHaveBeenCalledWith();
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('falls through to Clerk auth check when x-dev-user-sub header is absent', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null } as never);
    const req = makeReq({ headers: {} });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

// ─── Clerk authentication ─────────────────────────────────────────────────────

describe('Clerk authentication', () => {
  it('sets req.user.sub to Clerk userId and calls next() on valid session', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: 'user_abc123' } as never);
    const req = makeReq({ headers: { authorization: 'Bearer valid.token.here' } });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(req.user).toEqual({ sub: 'user_abc123' });
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next with 401 when Clerk userId is null (unauthenticated)', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null } as never);
    const req = makeReq({ headers: { authorization: 'Bearer expired.token' } });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(req.user).toBeUndefined();
  });

  it('calls next with 401 when no Authorization header is present', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null } as never);
    const req = makeReq({ headers: {} });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next with 401 when Authorization header is not Bearer', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null } as never);
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next with 401 (not 500) when getAuth throws on a malformed token', () => {
    vi.mocked(getAuth).mockImplementation(() => {
      throw new SyntaxError('Unexpected end of data');
    });
    const req = makeReq({ headers: { authorization: 'Bearer garbage.token.here' } });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(req.user).toBeUndefined();
  });
});

// ─── optionalAuthenticate ──────────────────────────────────────────────────────

describe('optionalAuthenticate()', () => {
  it('sets req.user from x-dev-user-sub header and calls next() (dev bypass)', () => {
    const req = makeReq({ headers: { 'x-dev-user-sub': 'user-123' } });
    const next = vi.fn() as unknown as NextFunction;

    optionalAuthenticate(req, res, next);

    expect(req.user).toEqual({ sub: 'user-123' });
    expect(next).toHaveBeenCalledWith();
    expect(getAuth).not.toHaveBeenCalled();
  });

  it('sets req.user when a valid session is present', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: 'user_abc123' } as never);
    const req = makeReq({ headers: { authorization: 'Bearer valid.token.here' } });
    const next = vi.fn() as unknown as NextFunction;

    optionalAuthenticate(req, res, next);

    expect(req.user).toEqual({ sub: 'user_abc123' });
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() without setting req.user or an error when there is no session', () => {
    vi.mocked(getAuth).mockReturnValue({ userId: null } as never);
    const req = makeReq({ headers: {} });
    const next = vi.fn() as unknown as NextFunction;

    optionalAuthenticate(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() without rejecting when getAuth throws on a malformed token', () => {
    vi.mocked(getAuth).mockImplementation(() => {
      throw new SyntaxError('Unexpected end of data');
    });
    const req = makeReq({ headers: { authorization: 'Bearer garbage.token.here' } });
    const next = vi.fn() as unknown as NextFunction;

    optionalAuthenticate(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
