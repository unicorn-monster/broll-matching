type FolderLike = { name: string };

export function filterFoldersByName<T extends FolderLike>(folders: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return folders;
  return folders.filter((f) => f.name.toLowerCase().includes(q));
}
