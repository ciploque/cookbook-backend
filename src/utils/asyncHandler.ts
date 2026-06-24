import { RequestHandler, Request, Response, NextFunction } from 'express';

export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
