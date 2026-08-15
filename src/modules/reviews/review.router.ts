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
  deleteReview,
  getMyReviewForRecipe,
  getRecipeReviewStats,
  listReviewsByRecipe,
  removeReviewImages,
  updateReview,
} from './review.controller';
import { getReviewAuthorId } from './review.service';
import {
  createReviewSchema,
  recipeReviewsParamsSchema,
  removeReviewImagesSchema,
  reviewParamsSchema,
  reviewQuerySchema,
  updateReviewSchema,
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
router.put(
  '/:reviewId',
  authenticate,
  validateReviewId,
  asyncHandler(ownerGuard),
  validate(updateReviewSchema, 'body'),
  asyncHandler(updateReview),
);
router.delete(
  '/:reviewId',
  authenticate,
  validateReviewId,
  asyncHandler(ownerGuard),
  asyncHandler(deleteReview),
);
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
// Authenticated read: the caller's own review of this recipe. `me` is a literal sibling
// of `summary`, so neither shadows the other nor the `/:recipeId/reviews` list above.
recipeReviewsRouter.get(
  '/:recipeId/reviews/me',
  authenticate,
  validateRecipeId,
  asyncHandler(getMyReviewForRecipe),
);

export default router;
