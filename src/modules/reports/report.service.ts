import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { ApiError } from '../../utils/ApiError';
import { buildMeta, toSkip } from '../../utils/pagination';
import { CreateRecipeReportInput, ReportQuery } from './report.schema';

const reportInclude = {
  recipe: { select: { id: true, slug: true, title: true, coverImageUrl: true } },
} satisfies Prisma.ReportInclude;

function formatReport(report: Prisma.ReportGetPayload<{ include: typeof reportInclude }>) {
  return {
    id: report.id,
    targetType: report.targetType,
    topic: report.topic,
    message: report.message,
    status: report.status,
    recipe: report.recipe,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

export async function createRecipeReport(
  authProviderId: string,
  recipeId: string,
  input: CreateRecipeReportInput,
) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { author: { select: { authProviderId: true } } },
  });

  if (!recipe) throw ApiError.notFound('Recipe');
  if (recipe.author.authProviderId === authProviderId) {
    throw ApiError.forbidden('You cannot report your own recipe');
  }

  const reporter = await prisma.user.findUnique({
    where: { authProviderId },
    select: { id: true },
  });
  if (!reporter) throw ApiError.notFound('User');

  try {
    const report = await prisma.report.create({
      data: {
        targetType: 'recipe',
        topic: input.topic,
        message: input.message,
        reporterId: reporter.id,
        recipeId,
      },
      include: reportInclude,
    });
    return formatReport(report);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('You have already reported this recipe');
    }
    throw err;
  }
}

export async function listMyReports(authProviderId: string, query: ReportQuery) {
  const reporter = await prisma.user.findUnique({
    where: { authProviderId },
    select: { id: true },
  });
  if (!reporter) throw ApiError.notFound('User');

  const { page, limit } = query;
  const where: Prisma.ReportWhereInput = { reporterId: reporter.id };
  const skip = toSkip(page, limit);

  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: reportInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return { data: reports.map(formatReport), meta: buildMeta(page, limit, total) };
}
