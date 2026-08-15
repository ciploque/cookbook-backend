import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { uploadImagesArray, uploadSingleImage } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createRecipeSchema,
  patchRecipeSchema,
  recipeParamsSchema,
  recipeQuerySchema,
  removeGalleryImagesSchema,
  updateRecipeSchema,
  userRecipesParamsSchema,
} from './recipe.schema';
import { getRecipeAuthorId } from './recipe.service';
import * as controller from './recipe.controller';

const router = Router();

const ownerGuard = authorize((req) => getRecipeAuthorId(req.params.recipeId as string));

// Runs before ownerGuard on every :recipeId route — the guard hits Prisma, and a malformed
// uuid there raises P2023 (a 500) instead of a clean 422. See recipe.schema.ts.
const validateRecipeId = validate(recipeParamsSchema, 'params');

// Image uploads are heavier than typical JSON writes — a stricter limit than the
// default write routes (which the recipes router otherwise has none of).
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', validate(recipeQuerySchema, 'query'), asyncHandler(controller.listRecipes));
// Public, but optionalAuthenticate resolves the caller (when there is one) so the detail
// response can carry the viewer-scoped hasReviewed / isSavedInCollection flags.
router.get(
  '/:recipeId',
  optionalAuthenticate,
  validateRecipeId,
  asyncHandler(controller.getRecipeById),
);
router.post('/', authenticate, validate(createRecipeSchema), asyncHandler(controller.createRecipe));
router.put(
  '/:recipeId',
  authenticate,
  validateRecipeId,
  asyncHandler(ownerGuard),
  validate(updateRecipeSchema),
  asyncHandler(controller.updateRecipe),
);
router.patch(
  '/:recipeId',
  authenticate,
  validateRecipeId,
  asyncHandler(ownerGuard),
  validate(patchRecipeSchema),
  asyncHandler(controller.patchRecipe),
);
router.delete(
  '/:recipeId',
  authenticate,
  validateRecipeId,
  asyncHandler(ownerGuard),
  asyncHandler(controller.deleteRecipe),
);
router.post(
  '/:recipeId/cover-image',
  authenticate,
  uploadLimiter,
  validateRecipeId,
  asyncHandler(ownerGuard),
  uploadSingleImage('image'),
  asyncHandler(controller.uploadCoverImage),
);
router.delete(
  '/:recipeId/cover-image',
  authenticate,
  uploadLimiter,
  validateRecipeId,
  asyncHandler(ownerGuard),
  asyncHandler(controller.deleteCoverImage),
);
router.post(
  '/:recipeId/images',
  authenticate,
  uploadLimiter,
  validateRecipeId,
  asyncHandler(ownerGuard),
  uploadImagesArray('images', 10),
  asyncHandler(controller.addGalleryImages),
);
router.delete(
  '/:recipeId/images',
  authenticate,
  uploadLimiter,
  validateRecipeId,
  asyncHandler(ownerGuard),
  validate(removeGalleryImagesSchema, 'body'),
  asyncHandler(controller.removeGalleryImages),
);

// Routes that live under the /users prefix but are owned by the recipes module.
// Mounted in app.ts at `${base}/v1/users`.
export const userRecipesRouter = Router();
// More-specific (3-segment) route first, per the documented invariant.
// :username/:recipename are plain strings (not uuids), so there is nothing to validate
// here — an unknown pair is a clean 404 from the service, never a P2023.
// optionalAuthenticate for the same reason as GET /recipes/:recipeId — same detail shape,
// same viewer-scoped flags.
userRecipesRouter.get(
  '/:username/recipes/:recipename',
  optionalAuthenticate,
  asyncHandler(controller.getRecipeByUsernameAndSlug),
);
userRecipesRouter.get(
  '/:userId/recipes',
  validate(userRecipesParamsSchema, 'params'),
  validate(recipeQuerySchema, 'query'),
  asyncHandler(controller.listRecipesByUser),
);

export default router;
