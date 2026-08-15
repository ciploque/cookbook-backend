import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { uploadImagesArray } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  addReviewImages,
  createReview,
  getRecipeReviewStats,
  listReviewsByRecipe,
  removeReviewImages,
} from './review.controller';
import { getReviewAuthorId } from './review.service';
import {
  createReviewSchema,
  recipeReviewsParamsSchema,
  removeReviewImagesSchema,
  reviewParamsSchema,
  reviewQuerySchema,
} from './review.schema';

const router = Router();

const ownerGuard = authorize((req) => getReviewAuthorId(req.params.reviewId as string));

// Runs before ownerGuard — the guard hits Prisma, and a malformed uuid there raises
// P2023 (a 500) instead of a clean 422. See review.schema.ts.
const validateReviewId = validate(reviewParamsSchema, 'params');
const validateRecipeId = validate(recipeReviewsParamsSchema, 'params');

// Image uploads are heavier than typical JSON writes — a stricter limit than the
// default writeLimiter this router is otherwise mounted under (see app.ts).
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/', authenticate, validate(createReviewSchema, 'body'), asyncHandler(createReview));
router.post(
  '/:reviewId/images',
  authenticate,
  uploadLimiter,
  validateReviewId,
  asyncHandler(ownerGuard),
  uploadImagesArray('images', 10),
  asyncHandler(addReviewImages),
);
router.delete(
  '/:reviewId/images',
  authenticate,
  uploadLimiter,
  validateReviewId,
  asyncHandler(ownerGuard),
  validate(removeReviewImagesSchema, 'body'),
  asyncHandler(removeReviewImages),
);

// Lives under the /recipes prefix but owned by the reviews module.
// Mounted in app.ts at `${base}/v1/recipes`.
export const recipeReviewsRouter = Router();
recipeReviewsRouter.get(
  '/:recipeId/reviews',
  validateRecipeId,
  validate(reviewQuerySchema, 'query'),
  asyncHandler(listReviewsByRecipe),
);
recipeReviewsRouter.get(
  '/:recipeId/reviews/summary',
  validateRecipeId,
  asyncHandler(getRecipeReviewStats),
);

export default router;
