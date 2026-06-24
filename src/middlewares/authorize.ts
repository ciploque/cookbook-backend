import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ApiError } from '../utils/ApiError';

export function authorize(
  getResourceOwnerId: (req: Request) => Promise<string | null>,
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    const ownerId = await getResourceOwnerId(req).catch(() => null);

    if (ownerId === null) {
      next(ApiError.notFound('Resource'));
      return;
    }

    if (req.user.sub !== ownerId) {
      next(ApiError.forbidden('You do not own this resource'));
      return;
    }

    next();
  };
}
