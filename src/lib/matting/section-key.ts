// src/lib/matting/section-key.ts
//
// Stable identity for an overlay shot, derived purely from its start/end in
// milliseconds. Used as a key in `disabledOverlayShots` so that disable
// decisions survive timeline reorders (shuffle) but are pruned when a section
// edit moves its boundaries (effectively becoming a different shot).

export interface SectionRange {
  startMs: number;
  endMs: number;
}

export function sectionKey(s: SectionRange): string {
  return `${s.startMs}-${s.endMs}`;
}

/** Returns a new Set containing only keys from `disabled` that still match a
 *  section in `liveSections`. Stale keys (sections that were deleted or whose
 *  boundaries changed) are dropped. */
export function pruneStaleKeys(
  disabled: Set<string>,
  liveSections: SectionRange[],
): Set<string> {
  const live = new Set(liveSections.map(sectionKey));
  const out = new Set<string>();
  for (const k of disabled) if (live.has(k)) out.add(k);
  return out;
}
