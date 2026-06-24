import { Request, Response } from 'express';
import * as recipeService from './recipe.service';
import {
  CreateRecipeInput,
  PatchRecipeInput,
  RecipeQuery,
  UpdateRecipeInput,
} from './recipe.schema';

export async function listRecipes(req: Request, res: Response): Promise<void> {
  const result = await recipeService.listRecipes(req.query as unknown as RecipeQuery);
  res.json({ success: true, ...result });
}

export async function getRecipeById(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.getRecipeById(req.params.recipeId as string);
  res.json({ success: true, data: recipe });
}

export async function createRecipe(req: Request, res: Response): Promise<void> {
  const recipe = await recipeService.createRecipe(
    req.user!.sub,
    req.body as CreateRecipeInput,
  );
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
