import { Router, raw } from 'express';
import { verifyClerkWebhook } from '../../middlewares/verifyClerkWebhook';
import { asyncHandler } from '../../utils/asyncHandler';
import * as controller from './clerk.webhook.controller';

const router = Router();

// Raw body is required for Svix/Standard Webhooks signature verification — must run before
// the app's global express.json(), which would otherwise consume and parse the body first.
router.post('/clerk', raw({ type: 'application/json' }), verifyClerkWebhook, asyncHandler(controller.handleClerkWebhook));

export default router;
