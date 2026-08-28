import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate';
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
// Public — optionalAuthenticate populates req.user (if a valid session is present) so the
// profile's own owner sees their private collections counted in `collectionCount`; it never
// rejects an unauthenticated request.
//
// :username is a plain string, not a uuid — nothing to validate; an unknown one is a
// clean 404 from the service. Registered before /:userId so it isn't swallowed by it.
router.get('/username/:username', optionalAuthenticate, asyncHandler(controller.getUserByUsername));
router.get(
  '/:userId',
  validate(userParamsSchema, 'params'),
  optionalAuthenticate,
  asyncHandler(controller.getUserById),
);

export default router;
