import { Request, Response } from 'express';
import * as collectionService from './collection.service';
import {
  AddRecipesInput,
  CollectionQuery,
  CreateCollectionInput,
  PatchCollectionInput,
  RemoveRecipesInput,
  UpdateCollectionInput,
} from './collection.schema';

// Public collections only, identically for every caller — the owner's full library is on the
// /users/me/collections routes below.
export async function listCollectionsByUser(req: Request, res: Response): Promise<void> {
  const result = await collectionService.listCollectionsByUser(
    req.params.userId as string,
    req.query as unknown as CollectionQuery,
  );
  res.json({ success: true, ...result });
}

export async function listMyCollections(req: Request, res: Response): Promise<void> {
  const result = await collectionService.listMyCollections(
    req.user!.sub,
    req.query as unknown as CollectionQuery,
  );
  res.json({ success: true, ...result });
}

export async function getCollectionById(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.getCollectionById(req.params.collectionId as string);
  res.json({ success: true, data: collection });
}

export async function getMyCollectionById(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.getMyCollectionById(
    req.params.collectionId as string,
    req.user!.sub,
  );
  res.json({ success: true, data: collection });
}

export async function createCollection(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.createCollection(
    req.user!.sub,
    req.body as CreateCollectionInput,
  );
  res.status(201).json({ success: true, data: collection });
}

export async function updateCollection(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.updateCollection(
    req.params.collectionId as string,
    req.body as UpdateCollectionInput,
  );
  res.json({ success: true, data: collection });
}

export async function patchCollection(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.patchCollection(
    req.params.collectionId as string,
    req.body as PatchCollectionInput,
  );
  res.json({ success: true, data: collection });
}

export async function deleteCollection(req: Request, res: Response): Promise<void> {
  await collectionService.deleteCollection(req.params.collectionId as string);
  res.status(204).send();
}

export async function addRecipesToCollection(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.addRecipesToCollection(
    req.params.collectionId as string,
    req.body as AddRecipesInput,
  );
  res.json({ success: true, data: collection });
}

export async function removeRecipesFromCollection(req: Request, res: Response): Promise<void> {
  const collection = await collectionService.removeRecipesFromCollection(
    req.params.collectionId as string,
    (req.body as RemoveRecipesInput).recipeIds,
  );
  res.json({ success: true, data: collection });
}

export async function followCollection(req: Request, res: Response): Promise<void> {
  await collectionService.followCollection(req.params.collectionId as string, req.user!.sub);
  res.json({ success: true });
}

export async function unfollowCollection(req: Request, res: Response): Promise<void> {
  await collectionService.unfollowCollection(req.params.collectionId as string, req.user!.sub);
  res.json({ success: true });
}
