import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/config/database', () => ({
  prisma: {
    tag: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../../src/config/database';
import { upsertTags } from '../../../src/modules/tags/tag.service';

beforeEach(() => vi.clearAllMocks());

describe('upsertTags()', () => {
  it('returns an empty array without hitting the database when given no names', async () => {
    const result = await upsertTags([]);

    expect(result).toEqual([]);
    expect(prisma.tag.createMany).not.toHaveBeenCalled();
    expect(prisma.tag.findMany).not.toHaveBeenCalled();
  });

  it('creates all tags in a single createMany call and fetches them in a single findMany', async () => {
    vi.mocked(prisma.tag.createMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.tag.findMany).mockResolvedValue([
      { id: 'tag-1', name: 'italian', slug: 'italian' },
      { id: 'tag-2', name: 'pasta', slug: 'pasta' },
    ]);

    const result = await upsertTags(['Italian', 'Pasta']);

    expect(prisma.tag.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.tag.createMany).toHaveBeenCalledWith({
      data: [
        { name: 'italian', slug: 'italian' },
        { name: 'pasta', slug: 'pasta' },
      ],
      skipDuplicates: true,
    });
    expect(prisma.tag.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.tag.findMany).toHaveBeenCalledWith({
      where: { slug: { in: ['italian', 'pasta'] } },
    });
    expect(result).toHaveLength(2);
  });

  it('de-duplicates tag names that slugify to the same value', async () => {
    vi.mocked(prisma.tag.createMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.tag.findMany).mockResolvedValue([
      { id: 'tag-1', name: 'italian', slug: 'italian' },
    ]);

    await upsertTags(['Italian', 'italian', 'ITALIAN']);

    expect(prisma.tag.createMany).toHaveBeenCalledWith({
      data: [{ name: 'italian', slug: 'italian' }],
      skipDuplicates: true,
    });
  });
});
