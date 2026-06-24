import { Tag } from '@prisma/client';
import { prisma } from '../../config/database';
import { slugify } from '../../utils/slugify';

export async function upsertTags(tagNames: string[]): Promise<Tag[]> {
  if (tagNames.length === 0) return [];

  const tags = await Promise.all(
    tagNames.map((name) => {
      const slug = slugify(name);
      return prisma.tag.upsert({
        where: { slug },
        update: {},
        create: { name: name.toLowerCase(), slug },
      });
    }),
  );
  return tags;
}
