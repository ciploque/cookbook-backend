import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

function devBypassSub(req: Request): string | null {
  if (env.NODE_ENV !== 'development') return null;
  const devSub = req.headers['x-dev-user-sub'];
  return devSub && typeof devSub === 'string' ? devSub : null;
}

// @clerk/backend's .d.ts imports `@clerk/shared/types`, which is ESM-only (.d.mts) and
// unresolvable under this project's CommonJS module resolution — getAuth()'s return type
// collapses to an unresolved type as a result (skipLibCheck hides the upstream .d.ts error,
// not the fallout here). The shape below matches Clerk's own documented usage.
function getAuthUserId(req: Request): string | null {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const auth: { userId: string | null } = getAuth(req);
  return auth.userId;
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const devSub = devBypassSub(req);
  if (devSub) {
    req.user = { sub: devSub };
    next();
    return;
  }

  let userId: string | null;
  try {
    userId = getAuthUserId(req);
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

// Populates req.user when a valid session (or dev-bypass header) is present, but never rejects
// the request — for routes that are readable by anyone but whose response varies by requester
// identity (e.g. private collection visibility for the owner).
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const devSub = devBypassSub(req);
  if (devSub) {
    req.user = { sub: devSub };
    next();
    return;
  }

  try {
    const userId = getAuthUserId(req);
    if (userId) {
      req.user = { sub: userId };
    }
  } catch {
    // Malformed token on an optional-auth route — proceed unauthenticated rather than reject.
  }

  next();
}
