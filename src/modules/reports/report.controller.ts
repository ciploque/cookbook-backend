import { Request, Response } from 'express';
import * as reportService from './report.service';
import { CreateRecipeReportInput, ReportQuery } from './report.schema';

export async function createRecipeReport(req: Request, res: Response): Promise<void> {
  const report = await reportService.createRecipeReport(
    req.user!.sub,
    req.params.recipeId as string,
    req.body as CreateRecipeReportInput,
  );
  res.status(201).json({ success: true, data: report });
}

export async function listMyReports(req: Request, res: Response): Promise<void> {
  const result = await reportService.listMyReports(
    req.user!.sub,
    req.query as unknown as ReportQuery,
  );
  res.json({ success: true, ...result });
}
