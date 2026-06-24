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
import { getRecipeAuthorKeycloakId } from './recipe.service';
import * as controller from './recipe.controller';

const router = Router();

const ownerGuard = authorize((req) => getRecipeAuthorKeycloakId(req.params.recipeId as string));

router.get('/', validate(recipeQuerySchema, 'query'), asyncHandler(controller.listRecipes));
router.get('/:recipeId', asyncHandler(controller.getRecipeById));
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

export default router;
