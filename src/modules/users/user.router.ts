import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { provisionUserSchema, updateUserSchema, userParamsSchema } from './user.schema';
import * as controller from './user.controller';

const router = Router();

router.post(
  '/me',
  authenticate,
  validate(provisionUserSchema),
  asyncHandler(controller.provisionMe),
);
router.get('/me', authenticate, asyncHandler(controller.getMe));
router.put('/me', authenticate, validate(updateUserSchema), asyncHandler(controller.updateMe));
// Fully public — no auth middleware, and the same body for every caller. A profile's own owner
// gets their private collections counted on GET /users/me instead, where identity is proven
// rather than inferred from the session that happens to be attached.
//
// :username is a plain string, not a uuid — nothing to validate; an unknown one is a
// clean 404 from the service. Registered before /:userId so it isn't swallowed by it.
router.get('/username/:username', asyncHandler(controller.getUserByUsername));
router.get('/:userId', validate(userParamsSchema, 'params'), asyncHandler(controller.getUserById));

export default router;
