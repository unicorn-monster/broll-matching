import type { OverlayItem } from "./overlay-types";

export interface CollisionTarget {
  trackIndex: number;
  startMs: number;
  durationMs: number;
  idToIgnore?: string;
}

export function isOverlapOnSameTrack(
  overlays: OverlayItem[],
  target: CollisionTarget,
): boolean {
  const tEnd = target.startMs + target.durationMs;
  for (const o of overlays) {
    if (o.trackIndex !== target.trackIndex) continue;
    if (target.idToIgnore && o.id === target.idToIgnore) continue;
    const oEnd = o.startMs + o.durationMs;
    if (target.startMs < oEnd && tEnd > o.startMs) return true;
  }
  return false;
}
