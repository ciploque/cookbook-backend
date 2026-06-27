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
  patchCollection,
  removeRecipesFromCollection,
  unfollowCollection,
  updateCollection,
} from './collection.controller';
import { getCollectionOwnerKeycloakId } from './collection.service';
import {
  addRecipesSchema,
  createCollectionSchema,
  patchCollectionSchema,
  removeRecipesSchema,
  updateCollectionSchema,
} from './collection.schema';

const router = Router();

const ownerGuard = authorize((req) =>
  getCollectionOwnerKeycloakId(req.params.collectionId as string),
);

// Public
router.get('/:collectionId', asyncHandler(getCollectionById));

// Metadata CRUD
router.post('/', authenticate, validate(createCollectionSchema, 'body'), asyncHandler(createCollection));
router.put('/:collectionId', authenticate, asyncHandler(ownerGuard), validate(updateCollectionSchema, 'body'), asyncHandler(updateCollection));
router.patch('/:collectionId', authenticate, asyncHandler(ownerGuard), validate(patchCollectionSchema, 'body'), asyncHandler(patchCollection));
router.delete('/:collectionId', authenticate, asyncHandler(ownerGuard), asyncHandler(deleteCollection));

// Recipe management
router.post('/:collectionId/recipes', authenticate, asyncHandler(ownerGuard), validate(addRecipesSchema, 'body'), asyncHandler(addRecipesToCollection));
router.delete('/:collectionId/recipes', authenticate, asyncHandler(ownerGuard), validate(removeRecipesSchema, 'body'), asyncHandler(removeRecipesFromCollection));

// Follow / unfollow
router.post('/:collectionId/follow', authenticate, asyncHandler(followCollection));
router.delete('/:collectionId/follow', authenticate, asyncHandler(unfollowCollection));

export default router;
