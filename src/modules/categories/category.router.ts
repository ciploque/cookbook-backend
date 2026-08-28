import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as controller from './category.controller';

const router = Router();

// A single public read. Categories are authored through the checked-in registry and
// `npm run categories:sync`, so there are deliberately no write endpoints here — same
// arrangement as the shelves router. The route takes no params, body or query, so there is
// nothing for `validate` to guard.
router.get('/', asyncHandler(controller.listCategories));

export default router;
