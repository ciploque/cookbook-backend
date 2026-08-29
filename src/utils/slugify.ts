export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function generateRecipeSlug(title: string): string {
  const base = slugify(title);
  return `${base}`;
}

// Same idea as generateRecipeSlug, with one addition: a name made entirely of characters slugify
// strips (emoji, CJK, punctuation) would yield '', and an empty slug can't be addressed by
// GET /users/:username/collections/:slug at all. Fall back to a constant so every collection has
// a reachable URL; the per-owner unique constraint then turns a second such name into a 409.
export function generateCollectionSlug(name: string): string {
  return slugify(name) || 'collection';
}
