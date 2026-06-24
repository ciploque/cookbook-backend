import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

vi.mock('../../../src/config/env', () => ({
  env: { NODE_ENV: 'development', KEYCLOAK_AUDIENCE: undefined },
  keycloakIssuer: 'http://localhost:8080/realms/cookbook',
}));

vi.mock('../../../src/config/keycloak', () => ({
  jwksClient: { getSigningKey: vi.fn() },
}));

vi.mock('jsonwebtoken', () => ({
  default: { verify: vi.fn() },
}));

import jwt from 'jsonwebtoken';
import { jwksClient } from '../../../src/config/keycloak';
import { authenticate } from '../../../src/middlewares/authenticate';

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
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('falls through to JWT path when x-dev-user-sub header is absent', () => {
    const req = makeReq({ headers: {} });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });
});

// ─── Authorization header validation ─────────────────────────────────────────

describe('Authorization header validation', () => {
  it('calls next with 401 when Authorization header is missing', () => {
    const req = makeReq({ headers: {} });
    const next = vi.fn() as unknown as NextFunction;

    // Temporarily set non-dev env for this test
    vi.doMock('../../../src/config/env', () => ({
      env: { NODE_ENV: 'production', KEYCLOAK_AUDIENCE: undefined },
      keycloakIssuer: 'http://localhost:8080/realms/cookbook',
    }));

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('calls next with 401 when Authorization header is not Bearer', () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    const next = vi.fn() as unknown as NextFunction;

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

// ─── JWT verification ─────────────────────────────────────────────────────────

describe('JWT verification', () => {
  it('sets req.user and calls next() on a valid token', () => {
    const req = makeReq({ headers: { authorization: 'Bearer valid.token.here' } });
    const next = vi.fn() as unknown as NextFunction;
    const decoded = { sub: 'user-uuid', email: 'user@example.com' };

    vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _opts, callback) => {
      (callback as Function)(null, decoded);
    });

    authenticate(req, res, next);

    expect(req.user).toEqual(decoded);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next with 401 when jwt.verify returns an error', () => {
    const req = makeReq({ headers: { authorization: 'Bearer expired.token' } });
    const next = vi.fn() as unknown as NextFunction;

    vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _opts, callback) => {
      (callback as Function)(new Error('TokenExpiredError'), null);
    });

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(req.user).toBeUndefined();
  });

  it('calls next with 401 when decoded payload is null', () => {
    const req = makeReq({ headers: { authorization: 'Bearer bad.payload' } });
    const next = vi.fn() as unknown as NextFunction;

    vi.mocked(jwt.verify).mockImplementation((_token, _getKey, _opts, callback) => {
      (callback as Function)(null, null);
    });

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('uses jwksClient to resolve the signing key', () => {
    const req = makeReq({ headers: { authorization: 'Bearer some.token' } });
    const next = vi.fn() as unknown as NextFunction;
    const mockKey = { getPublicKey: () => 'public-key' };

    // Simulate getSigningKey calling its callback with a key
    vi.mocked(jwksClient.getSigningKey).mockImplementation((_kid, callback) => {
      (callback as Function)(null, mockKey);
    });

    vi.mocked(jwt.verify).mockImplementation((_token, getKey, _opts, callback) => {
      // Call getKey with a fake header to verify jwksClient is used
      (getKey as Function)({ kid: 'key-id-123' }, (err: unknown, key: unknown) => {
        expect(err).toBeNull();
        expect(key).toBe('public-key');
      });
      (callback as Function)(null, { sub: 'user-1' });
    });

    authenticate(req, res, next);

    expect(jwksClient.getSigningKey).toHaveBeenCalledWith('key-id-123', expect.any(Function));
  });
});
