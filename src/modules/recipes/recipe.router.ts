import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createRecipeSchema,
  patchRecipeSchema,
  recipeQuerySchema,
  updateRecipeSchema,
} from './recipe.schema';
import { getRecipeAuthorId } from './recipe.service';
import * as controller from './recipe.controller';

const router = Router();

const ownerGuard = authorize((req) => getRecipeAuthorId(req.params.recipeId as string));

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
