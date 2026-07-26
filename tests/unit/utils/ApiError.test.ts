import { describe, it, expect } from 'vitest';
import { ApiError } from '../../../src/utils/ApiError';

describe('ApiError', () => {
  it('extends Error and sets prototype chain correctly', () => {
    const err = new ApiError(400, 'Bad request', 'BAD_REQUEST');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
  });

  it('stores statusCode, message, code, and details', () => {
    const details = { field: 'required' };
    const err = new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', details);
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Validation failed');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual(details);
  });

  describe('unauthorized()', () => {
    it('returns 401 with default message', () => {
      const err = ApiError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe('Unauthorized');
    });

    it('accepts a custom message', () => {
      const err = ApiError.unauthorized('Token expired');
      expect(err.message).toBe('Token expired');
    });
  });

  describe('forbidden()', () => {
    it('returns 403 with default message', () => {
      const err = ApiError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });

    it('accepts a custom message', () => {
      const err = ApiError.forbidden('Not your resource');
      expect(err.message).toBe('Not your resource');
    });
  });

  describe('notFound()', () => {
    it('generates correct code from resource name', () => {
      const err = ApiError.notFound('Recipe');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('RECIPE_NOT_FOUND');
      expect(err.message).toBe('Recipe not found');
    });

    it('uppercases multi-word resource names', () => {
      const err = ApiError.notFound('User profile');
      expect(err.code).toBe('USER_PROFILE_NOT_FOUND');
    });

    it('replaces every space in a 3+ word resource name, not just the first', () => {
      const err = ApiError.notFound('Review author profile');
      expect(err.code).toBe('REVIEW_AUTHOR_PROFILE_NOT_FOUND');
    });
  });

  describe('conflict()', () => {
    it('returns 409 with CONFLICT code', () => {
      const err = ApiError.conflict('Username already taken');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe('Username already taken');
    });
  });

  describe('validation()', () => {
    it('returns 422 with field error details', () => {
      const fieldErrors = { username: ['too short'] };
      const err = ApiError.validation(fieldErrors);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual(fieldErrors);
    });
  });

  describe('internal()', () => {
    it('returns 500 with default message', () => {
      const err = ApiError.internal();
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('Internal server error');
    });
  });
});
