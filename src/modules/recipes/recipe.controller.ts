import { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import * as recipeService from './recipe.service';
import {
  CreateRecipeInput,
  PatchRecipeInput,
  RecipeQuery,
  RemoveGalleryImagesInput,
  UpdateRecipeInput,
} from './recipe.schema';

export async function listRecipes(req: Request, res: Response): Promise<void> {
  const result = await recipeService.listRecipes(req.query as unknown as RecipeQuery);
  res.json({ success: true, ...result });
}

// optionalAuthenticate populates req.user only when a valid session is present — an anonymous
// caller gets `undefined` here, which the service resolves to false/false viewer state.
export async function getRecipeById(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.getRecipeById(req.params.recipeId as string, req.user?.sub);
  res.json({ success: true, data: recipe });
}

export async function createRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.createRecipe(req.user!.sub, req.body as CreateRecipeInput);
  res.status(201).json({ success: true, data: recipe });
}

export async function updateRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.updateRecipe(
    req.params.recipeId as string,
    req.body as UpdateRecipeInput,
  );
  res.json({ success: true, data: recipe });
}

export async function patchRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.patchRecipe(
    req.params.recipeId as string,
    req.body as PatchRecipeInput,
  );
  res.json({ success: true, data: recipe });
}

export async function deleteRecipe(req: Request, res: Response): Promise<void> {
  await recipeService.deleteRecipe(req.params.recipeId as string);
  res.status(204).send();
}

export async function getRecipeByUsernameAndSlug(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.getRecipeByUsernameAndSlug(
    req.params.username as string,
    req.params.recipename as string,
    req.user?.sub,
  );
  res.json({ success: true, data: recipe });
}

export async function listRecipesByUser(req: Request, res: Response): Promise<void> {
  const result = await recipeService.listRecipesByUser(
    req.params.userId as string,
    req.query as unknown as RecipeQuery,
  );
  res.json({ success: true, ...result });
}

export async function uploadCoverImage(req: Request, res: Response): Promise<void> {
  if (!req.file) throw ApiError.validation({ image: ['No image file was provided'] });

  const recipe = await recipeService.uploadCoverImage(
    req.params.recipeId as string,
    req.file.buffer,
  );
  res.json({ success: true, data: recipe });
}

export async function deleteCoverImage(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.deleteCoverImage(req.params.recipeId as string);
  res.json({ success: true, data: recipe });
}

export async function addGalleryImages(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw ApiError.validation({ images: ['No image files were provided'] });

  const recipe = await recipeService.addGalleryImages(
    req.params.recipeId as string,
    files.map((file) => file.buffer),
  );
  res.json({ success: true, data: recipe });
}

export async function removeGalleryImages(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.removeGalleryImages(
    req.params.recipeId as string,
    (req.body as RemoveGalleryImagesInput).paths,
  );
  res.json({ success: true, data: recipe });
}
