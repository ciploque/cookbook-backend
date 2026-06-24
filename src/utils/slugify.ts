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
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}
