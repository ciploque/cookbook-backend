import { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import * as reviewService from './review.service';
import {
  CreateReviewInput,
  RemoveReviewImagesInput,
  ReviewQuery,
  UpdateReviewInput,
} from './review.schema';

export async function listReviewsByRecipe(req: Request, res: Response): Promise<void> {
  const result = await reviewService.listReviewsByRecipe(
    req.params.recipeId as string,
    req.query as unknown as ReviewQuery,
  );
  res.json({ success: true, ...result });
}

export async function createReview(req: Request, res: Response): Promise<void> {
  const review = await reviewService.createReview(req.user!.sub, req.body as CreateReviewInput);
  res.status(201).json({ success: true, data: review });
}

export async function getMyReviewForRecipe(req: Request, res: Response): Promise<void> {
  const review = await reviewService.getMyReviewForRecipe(
    req.user!.sub,
    req.params.recipeId as string,
  );
  res.json({ success: true, data: review });
}

export async function updateReview(req: Request, res: Response): Promise<void> {
  const review = await reviewService.updateReview(
    req.params.reviewId as string,
    req.body as UpdateReviewInput,
  );
  res.json({ success: true, data: review });
}

export async function deleteReview(req: Request, res: Response): Promise<void> {
  await reviewService.deleteReview(req.params.reviewId as string);
  res.status(204).send();
}

export async function getRecipeReviewStats(req: Request, res: Response): Promise<void> {
  const stats = await reviewService.getReviewStats(req.params.recipeId as string);
  res.json({ success: true, data: stats });
}

export async function addReviewImages(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw ApiError.validation({ images: ['No image files were provided'] });

  const review = await reviewService.addReviewImages(
    req.params.reviewId as string,
    files.map((file) => file.buffer),
  );
  res.json({ success: true, data: review });
}

export async function removeReviewImages(req: Request, res: Response): Promise<void> {
  const review = await reviewService.removeReviewImages(
    req.params.reviewId as string,
    (req.body as RemoveReviewImagesInput).paths,
  );
  res.json({ success: true, data: review });
}
