import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodType } from 'zod';
import { ApiError } from '../utils/ApiError';

type Target = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodType<T>, target: Target = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(ApiError.validation(result.error.flatten().fieldErrors));
      return;
    }
    req[target] = result.data;
    next();
  };
}
