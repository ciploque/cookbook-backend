import { Request, Response, NextFunction } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { ApiError } from '../utils/ApiError';

// Requires the raw request body (Buffer) — mount `express.raw({ type: 'application/json' })`
// ahead of this middleware, and ahead of the app's global `express.json()`.
export async function verifyClerkWebhook(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.clerkEvent = await verifyWebhook(req);
    next();
  } catch (err) {
    next(new ApiError(400, 'Invalid webhook signature', 'INVALID_WEBHOOK_SIGNATURE', err instanceof Error ? err.message : undefined));
  }
}
