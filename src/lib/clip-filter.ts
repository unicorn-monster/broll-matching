type ClipLike = { brollName: string; filename: string };

export function filterClipsByQuery<T extends ClipLike>(clips: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return clips;
  return clips.filter(
    (c) => c.brollName.toLowerCase().includes(q) || c.filename.toLowerCase().includes(q)
  );
}
