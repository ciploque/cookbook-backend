import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodType } from 'zod';
import { ApiError } from '../utils/ApiError';

type Target = 'body' | 'query' | 'params';

// PostgreSQL `text` columns cannot store a NUL byte (0x00); one reaching Prisma throws an
// unhandled error that surfaces as a 500. Reject it here so it becomes a clean 422 instead.
const NUL_BYTE = String.fromCharCode(0);

function containsNullByte(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(NUL_BYTE);
  if (Array.isArray(value)) return value.some(containsNullByte);
  if (value && typeof value === 'object') return Object.values(value).some(containsNullByte);
  return false;
}

export function validate<T>(schema: ZodType<T>, target: Target = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(ApiError.validation(result.error.flatten().fieldErrors));
      return;
    }
    if (containsNullByte(result.data)) {
      next(ApiError.validation({ [target]: ['Input must not contain NUL (0x00) bytes'] }));
      return;
    }
    req[target] = result.data;
    next();
  };
}
