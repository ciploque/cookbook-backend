import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { getShelf, listShelves } from './shelf.controller';
import { shelfParamsSchema, shelfQuerySchema } from './shelf.schema';

const router = Router();

// Both routes are public reads. Shelves are authored through the checked-in registry and
// `npm run shelves:sync` — there are deliberately no write endpoints here.
router.get('/', asyncHandler(listShelves));

router.get(
  '/:slug',
  validate(shelfParamsSchema, 'params'),
  validate(shelfQuerySchema, 'query'),
  asyncHandler(getShelf),
);

export default router;
