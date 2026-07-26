import { Tag } from '@prisma/client';
import { prisma } from '../../config/database';
import { slugify } from '../../utils/slugify';

export async function upsertTags(tagNames: string[]): Promise<Tag[]> {
  if (tagNames.length === 0) return [];

  const entries = tagNames.map((name) => ({
    name: name.toLowerCase(),
    slug: slugify(name),
  }));

  const uniqueSlugs = [...new Set(entries.map((e) => e.slug))];
  const uniqueEntries = uniqueSlugs.map((slug) => entries.find((e) => e.slug === slug)!);

  await prisma.tag.createMany({
    data: uniqueEntries,
    skipDuplicates: true,
  });

  return prisma.tag.findMany({
    where: { slug: { in: uniqueSlugs } },
  });
}
