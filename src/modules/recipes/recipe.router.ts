import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { uploadImagesArray, uploadSingleImage } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createRecipeSchema,
  patchRecipeSchema,
  recipeQuerySchema,
  removeGalleryImagesSchema,
  updateRecipeSchema,
} from './recipe.schema';
import { getRecipeAuthorId } from './recipe.service';
import * as controller from './recipe.controller';

const router = Router();

const ownerGuard = authorize((req) => getRecipeAuthorId(req.params.recipeId as string));

// Image uploads are heavier than typical JSON writes — a stricter limit than the
// default write routes (which the recipes router otherwise has none of).
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', validate(recipeQuerySchema, 'query'), asyncHandler(controller.listRecipes));
router.get('/:recipeId', authenticate, asyncHandler(controller.getRecipeById));
router.post(
  '/',
  authenticate,
  validate(createRecipeSchema),
  asyncHandler(controller.createRecipe),
);
router.put(
  '/:recipeId',
  authenticate,
  asyncHandler(ownerGuard),
  validate(updateRecipeSchema),
  asyncHandler(controller.updateRecipe),
);
router.patch(
  '/:recipeId',
  authenticate,
  asyncHandler(ownerGuard),
  validate(patchRecipeSchema),
  asyncHandler(controller.patchRecipe),
);
router.delete(
  '/:recipeId',
  authenticate,
  asyncHandler(ownerGuard),
  asyncHandler(controller.deleteRecipe),
);
router.post(
  '/:recipeId/cover-image',
  authenticate,
  uploadLimiter,
  asyncHandler(ownerGuard),
  uploadSingleImage('image'),
  asyncHandler(controller.uploadCoverImage),
);
router.delete(
  '/:recipeId/cover-image',
  authenticate,
  uploadLimiter,
  asyncHandler(ownerGuard),
  asyncHandler(controller.deleteCoverImage),
);
router.post(
  '/:recipeId/images',
  authenticate,
  uploadLimiter,
  asyncHandler(ownerGuard),
  uploadImagesArray('images', 10),
  asyncHandler(controller.addGalleryImages),
);
router.delete(
  '/:recipeId/images',
  authenticate,
  uploadLimiter,
  asyncHandler(ownerGuard),
  validate(removeGalleryImagesSchema, 'body'),
  asyncHandler(controller.removeGalleryImages),
);

// Routes that live under the /users prefix but are owned by the recipes module.
// Mounted in app.ts at `${base}/v1/users`.
export const userRecipesRouter = Router();
// More-specific (3-segment) route first, per the documented invariant.
userRecipesRouter.get(
  '/:username/recipes/:recipename',
  asyncHandler(controller.getRecipeByUsernameAndSlug),
);
userRecipesRouter.get(
  '/:userId/recipes',
  validate(recipeQuerySchema, 'query'),
  asyncHandler(controller.listRecipesByUser),
);

export default router;
