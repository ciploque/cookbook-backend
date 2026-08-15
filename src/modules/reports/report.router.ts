import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { createRecipeReport, listMyReports } from './report.controller';
import {
  createRecipeReportSchema,
  recipeReportParamsSchema,
  reportQuerySchema,
} from './report.schema';

const router = Router();

router.get('/me', authenticate, validate(reportQuerySchema, 'query'), asyncHandler(listMyReports));

// Lives under the /recipes prefix but owned by the reports module.
// Mounted in app.ts at `${base}/v1/recipes`.
export const recipeReportsRouter = Router();
recipeReportsRouter.post(
  '/:recipeId/reports',
  authenticate,
  validate(recipeReportParamsSchema, 'params'),
  validate(createRecipeReportSchema, 'body'),
  asyncHandler(createRecipeReport),
);

export default router;
