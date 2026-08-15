import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { validate } from '../../../src/middlewares/validate';

const NUL = String.fromCharCode(0);

type Target = 'body' | 'query' | 'params';

function run(schema: z.ZodTypeAny, target: Target, data: unknown) {
  const req = { body: undefined, query: undefined, params: undefined } as unknown as Request;
  (req as unknown as Record<Target, unknown>)[target] = data;
  const next = vi.fn();
  validate(schema, target)(req, {} as Response, next);
  return { req, next };
}

describe('validate()', () => {
  it('passes valid input through and strips unknown keys', () => {
    const schema = z.object({ name: z.string() });
    const { req, next } = run(schema, 'body', { name: 'ok', extra: 'stripped' });

    expect(next).toHaveBeenCalledWith(); // called with no error
    expect(req.body).toEqual({ name: 'ok' });
  });

  it('returns 422 when the schema fails', () => {
    const schema = z.object({ name: z.string() });
    const { next } = run(schema, 'body', { name: 123 });

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('rejects a NUL byte in a top-level string field with 422', () => {
    const schema = z.object({ title: z.string() });
    const { next } = run(schema, 'body', { title: `a${NUL}b` });

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('rejects a NUL byte nested inside arrays/objects', () => {
    const schema = z.object({ items: z.array(z.object({ note: z.string() })) });
    const { next } = run(schema, 'body', { items: [{ note: `x${NUL}` }] });

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
  });

  it('rejects a NUL byte in query params too', () => {
    const schema = z.object({ q: z.string() });
    const { next } = run(schema, 'query', { q: `bad${NUL}` });

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 422 });
  });
});
