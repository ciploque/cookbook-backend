import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { createReview } from './review.controller';
import { createReviewSchema } from './review.schema';

const router = Router();

router.post('/', authenticate, validate(createReviewSchema, 'body'), asyncHandler(createReview));

export default router;
