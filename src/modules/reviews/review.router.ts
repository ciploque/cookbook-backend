import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { createReview, getRecipeReviewStats, listReviewsByRecipe } from './review.controller';
import { createReviewSchema, reviewQuerySchema } from './review.schema';

const router = Router();

router.post('/', authenticate, validate(createReviewSchema, 'body'), asyncHandler(createReview));

// Lives under the /recipes prefix but owned by the reviews module.
// Mounted in app.ts at `${base}/v1/recipes`.
export const recipeReviewsRouter = Router();
recipeReviewsRouter.get(
  '/:recipeId/reviews',
  validate(reviewQuerySchema, 'query'),
  asyncHandler(listReviewsByRecipe),
);
recipeReviewsRouter.get('/:recipeId/reviews/summary', asyncHandler(getRecipeReviewStats));

export default router;
