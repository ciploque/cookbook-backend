import { CategoryDefinition } from './category.schema';

/**
 * The curated registry of recipe categories.
 *
 * This file is the source of truth: `npm run categories:sync` validates every entry and
 * upserts it by slug. Adding a category is a code change — reviewed and versioned in git —
 * rather than a side effect of someone typing a new value into a recipe form, which is
 * exactly what keeps the category list free of near-duplicates ("dessert"/"deserts") and the
 * counts on `GET /categories` meaningful. This is the deliberate difference from tags, which
 * *are* created on the fly by recipe writes (see tag.service.ts#upsertTags).
 *
 * Unlike `shelves:sync`, sync does **not** delete categories missing from this file: a
 * category is referenced by recipe_categories rows that cascade, so a deletion would silently
 * unlabel every recipe using it. Removing a category is a deliberate manual act.
 *
 * `slug` is what recipes reference and what `GET /recipes?category=` filters on — changing a
 * slug orphans existing references, so treat it as immutable once shipped. `name` is the
 * display label and can be edited freely.
 */
export const categoryDefinitions: CategoryDefinition[] = [
  { name: 'Breakfast', slug: 'breakfast' },
  { name: 'Lunch', slug: 'lunch' },
  { name: 'Dinner', slug: 'dinner' },
  { name: 'Appetizers', slug: 'appetizers' },
  { name: 'Salads', slug: 'salads' },
  { name: 'Soups', slug: 'soups' },
  { name: 'Main Courses', slug: 'main-courses' },
  { name: 'Side Dishes', slug: 'side-dishes' },
  { name: 'Baking', slug: 'baking' },
  { name: 'Desserts', slug: 'desserts' },
  { name: 'Snacks', slug: 'snacks' },
  { name: 'Sauces', slug: 'sauces' },
  // Referenced by the `top-drinks` shelf in shelves.config.ts — that row resolves to nothing
  // if this slug is absent from the registry.
  { name: 'Drinks', slug: 'drinks' },
  { name: 'Vegetarian', slug: 'vegetarian' },
  { name: 'Vegan', slug: 'vegan' },
];
