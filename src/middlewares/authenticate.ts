import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (env.NODE_ENV === 'development') {
    const devSub = req.headers['x-dev-user-sub'];
    if (devSub && typeof devSub === 'string') {
      req.user = { sub: devSub };
      next();
      return;
    }
  }

  let userId: string | null = null;
  try {
    userId = getAuth(req).userId;
  } catch {
    // getAuth throws on a structurally malformed token — treat as unauthenticated, not a 500.
    next(ApiError.unauthorized('Invalid or malformed token'));
    return;
  }

  if (!userId) {
    next(ApiError.unauthorized('Missing or invalid authentication'));
    return;
  }

  req.user = { sub: userId };
  next();
}
