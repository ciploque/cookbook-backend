import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  addRecipesToCollection,
  createCollection,
  deleteCollection,
  followCollection,
  getCollectionById,
  getCollectionByUsernameAndSlug,
  getMyCollectionById,
  getMyCollectionBySlug,
  listCollectionsByUser,
  listMyCollections,
  patchCollection,
  removeRecipesFromCollection,
  unfollowCollection,
  updateCollection,
} from './collection.controller';
import { getOwnerId } from './collection.service';
import {
  addRecipesSchema,
  collectionParamsSchema,
  collectionQuerySchema,
  createCollectionSchema,
  patchCollectionSchema,
  removeRecipesSchema,
  updateCollectionSchema,
  userCollectionsParamsSchema,
} from './collection.schema';

const router = Router();

const ownerGuard = authorize((req) => getOwnerId(req.params.collectionId as string));

// Runs before ownerGuard — the guard hits Prisma, and a malformed uuid there raises
// P2023 (a 500) instead of a clean 422. See collection.schema.ts.
const validateCollectionId = validate(collectionParamsSchema, 'params');

// Fully public — no auth middleware, and a private collection is a 404 for every caller. The
// owner reaches their own through GET /users/me/collections/:collectionId below.
router.get('/:collectionId', validateCollectionId, asyncHandler(getCollectionById));

// Metadata CRUD
router.post(
  '/',
  authenticate,
  validate(createCollectionSchema, 'body'),
  asyncHandler(createCollection),
);
router.put(
  '/:collectionId',
  authenticate,
  validateCollectionId,
  asyncHandler(ownerGuard),
  validate(updateCollectionSchema, 'body'),
  asyncHandler(updateCollection),
);
router.patch(
  '/:collectionId',
  authenticate,
  validateCollectionId,
  asyncHandler(ownerGuard),
  validate(patchCollectionSchema, 'body'),
  asyncHandler(patchCollection),
);
router.delete(
  '/:collectionId',
  authenticate,
  validateCollectionId,
  asyncHandler(ownerGuard),
  asyncHandler(deleteCollection),
);

// Recipe management
router.post(
  '/:collectionId/recipes',
  authenticate,
  validateCollectionId,
  asyncHandler(ownerGuard),
  validate(addRecipesSchema, 'body'),
  asyncHandler(addRecipesToCollection),
);
router.delete(
  '/:collectionId/recipes',
  authenticate,
  validateCollectionId,
  asyncHandler(ownerGuard),
  validate(removeRecipesSchema, 'body'),
  asyncHandler(removeRecipesFromCollection),
);

// Follow / unfollow
router.post(
  '/:collectionId/follow',
  authenticate,
  validateCollectionId,
  asyncHandler(followCollection),
);
router.delete(
  '/:collectionId/follow',
  authenticate,
  validateCollectionId,
  asyncHandler(unfollowCollection),
);

// Lives under the /users prefix but owned by the collections module.
// Mounted in app.ts at `${base}/v1/users`.
export const userCollectionsRouter = Router();

// Registered before /:userId/collections so "me" isn't swallowed by the :userId
// wildcard — same pattern as /users/:username/recipes/:recipename vs
// /users/:userId/recipes in recipe.router.ts.
userCollectionsRouter.get(
  '/me/collections',
  authenticate,
  validate(collectionQuerySchema, 'query'),
  asyncHandler(listMyCollections),
);
// The owner-scoped counterpart to GET /collections/:collectionId — the caller's own collection,
// public or private. Reuses collectionParamsSchema: collectionId is this route's only param, so
// it satisfies the "declare every param" rule (see CLAUDE.md → Route Param Validation).
userCollectionsRouter.get(
  '/me/collections/:collectionId',
  authenticate,
  validate(collectionParamsSchema, 'params'),
  asyncHandler(getMyCollectionById),
);
// The by-slug form of the route above, for a frontend that lands on a collection URL knowing
// only the slug. The literal `slug` segment is what keeps this unambiguous: at four segments it
// can be shadowed by neither /me/collections/:collectionId nor /:username/collections/:slug,
// which are three, so its position in this file carries no ordering hazard.
//
// No params schema, for the same reason /:username/collections/:slug has none: :slug is a plain
// string, so it can't raise a Prisma P2023, and an unknown value is already a clean 404 from the
// service (see CLAUDE.md → Route Param Validation).
userCollectionsRouter.get(
  '/me/collections/slug/:slug',
  authenticate,
  asyncHandler(getMyCollectionBySlug),
);
// Fully public — no auth middleware, public collections only, the same list for every caller.
userCollectionsRouter.get(
  '/:userId/collections',
  validate(userCollectionsParamsSchema, 'params'),
  validate(collectionQuerySchema, 'query'),
  asyncHandler(listCollectionsByUser),
);
// The SEO-friendly form of GET /collections/:collectionId — same public-only behaviour, addressed
// by owner username + collection slug. Registered after /me/collections/:collectionId, which has
// the same segment count and would otherwise be swallowed by the :username wildcard.
//
// No params schema: both params are plain strings, so neither can raise a Prisma P2023, and an
// unknown value is already a clean 404 from the service — the same reasoning that leaves
// GET /users/:username/recipes/:recipename unvalidated (see CLAUDE.md → Route Param Validation).
userCollectionsRouter.get(
  '/:username/collections/:slug',
  asyncHandler(getCollectionByUsernameAndSlug),
);

export default router;
