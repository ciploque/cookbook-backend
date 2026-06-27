import { Request, Response } from 'express';
import * as reviewService from './review.service';
import { CreateReviewInput, ReviewQuery } from './review.schema';

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
