import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(ApiError.validation(result.error.flatten().fieldErrors));
      return;
    }
    req[target] = result.data as typeof req[typeof target];
    next();
  };
}
