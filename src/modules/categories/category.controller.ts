import { Request, Response } from 'express';
import * as categoryService from './category.service';

export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await categoryService.listCategories();
  res.json({ success: true, data: categories });
}
