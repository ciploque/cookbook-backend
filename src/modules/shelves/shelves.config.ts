import { ShelfDefinition } from './shelf.schema';

/**
 * The manual registry of themed landing-page rows.
 *
 * This file is the source of truth: `npm run shelves:sync` upserts every entry and *deletes*
 * any shelf in the database that is not listed here, then refreshes contents. Editing a row
 * is a code change — reviewed and versioned in git — rather than an admin UI action.
 *
 * To add a row, append a definition. Its `criteria` must satisfy the schema of the resolver
 * named by `source` (see src/modules/shelves/resolvers/), which sync validates before writing.
 *
 * `position` orders the rows on the landing page. `startsAt`/`endsAt` are an optional publish
 * window — a shelf outside its window disappears from the API without anyone toggling it.
 */
export const shelfDefinitions: ShelfDefinition[] = [
  {
    slug: 'recently-added',
    title: 'Recently Added',
    subtitle: 'Fresh from the kitchen',
    position: 0,
    source: 'query',
    criteria: { sortBy: 'createdAt', order: 'desc' },
    maxItems: 20,
  },
  {
    slug: 'top-rated',
    title: 'Top Rated',
    subtitle: 'The community favourites',
    position: 1,
    source: 'query',
    criteria: { sortBy: 'averageRating', order: 'desc', minRating: 4 },
    maxItems: 20,
  },
  {
    slug: 'trending-this-week',
    title: 'Trending This Week',
    subtitle: 'What everyone is cooking right now',
    position: 2,
    source: 'trending',
    criteria: { windowDays: 7 },
    maxItems: 20,
  },
  {
    slug: 'top-drinks',
    title: 'Top Drinks',
    subtitle: 'Highest rated, shaken and stirred',
    position: 3,
    source: 'query',
    criteria: { category: 'drinks', sortBy: 'averageRating', order: 'desc' },
    maxItems: 20,
  },
  // A seasonal row: activates and retires on its own via the publish window.
  {
    slug: 'spooky-season',
    title: 'Spooky Season',
    subtitle: 'Treats with a trick to them',
    position: 4,
    source: 'query',
    criteria: { tags: 'halloween' },
    maxItems: 20,
    startsAt: '2026-10-01',
    endsAt: '2026-11-02',
  },
  // The editorial escape hatch, for a row no query can express. Left out rather than stubbed
  // because `manual` criteria must be real recipe UUIDs — sync rejects placeholders:
  //
  // {
  //   slug: 'editors-picks',
  //   title: "Editor's Picks",
  //   position: 5,
  //   source: 'manual',
  //   criteria: { recipeIds: ['<recipe-uuid>', '<recipe-uuid>'] },
  // },
];
