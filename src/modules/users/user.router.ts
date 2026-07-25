import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { provisionUserSchema, updateUserSchema } from './user.schema';
import * as controller from './user.controller';

const router = Router();

router.post('/me', authenticate, validate(provisionUserSchema), asyncHandler(controller.provisionMe));
router.get('/me', authenticate, asyncHandler(controller.getMe));
router.put('/me', authenticate, validate(updateUserSchema), asyncHandler(controller.updateMe));
router.get('/username/:username', asyncHandler(controller.getUserByUsername));
router.get('/:userId', asyncHandler(controller.getUserById));

export default router;
