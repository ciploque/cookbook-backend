import { Request, Response } from 'express';
import * as shelfService from './shelf.service';
import { ShelfQuery } from './shelf.schema';

export async function listShelves(_req: Request, res: Response): Promise<void> {
  const shelves = await shelfService.listActiveShelves();
  res.json({ success: true, data: shelves });
}

export async function getShelf(req: Request, res: Response): Promise<void> {
  const { shelf, data, meta } = await shelfService.getShelfBySlug(
    req.params.slug as string,
    req.query as unknown as ShelfQuery,
  );
  res.json({ success: true, shelf, data, meta });
}
