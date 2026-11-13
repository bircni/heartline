/** Id derived from a name: `Core services` → `core-services`. Used for group ids in status.yaml and migrations. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'group'
  );
}

/** The id a status.yaml group gets: its own `id`, else one derived from the name (as the migration did). */
export function configGroupId(g: { id?: string; name: string }): string {
  return g.id ?? slugify(g.name);
}
