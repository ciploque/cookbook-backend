import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  addRecipesToCollection,
  createCollection,
  deleteCollection,
  followCollection,
  getCollectionById,
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

// Public — optionalAuthenticate populates req.user (if a valid session is present) so the
// owner can see their own private collection; it never rejects an unauthenticated request.
router.get(
  '/:collectionId',
  validateCollectionId,
  optionalAuthenticate,
  asyncHandler(getCollectionById),
);

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
// Public — optionalAuthenticate lets the owner see their own private collections here too,
// without rejecting anonymous callers.
userCollectionsRouter.get(
  '/:userId/collections',
  validate(userCollectionsParamsSchema, 'params'),
  optionalAuthenticate,
  validate(collectionQuerySchema, 'query'),
  asyncHandler(listCollectionsByUser),
);

export default router;
