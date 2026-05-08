export type SnapKind = "playhead" | "section" | "edge" | "zero";

export interface SnapCandidate {
  ms: number;
  kind: SnapKind;
}

export interface SnapResult {
  snappedStartMs: number;
  snapTarget: SnapKind | null;
}

const PRIORITY: Record<SnapKind, number> = {
  playhead: 4,
  section: 3,
  edge: 2,
  zero: 1,
};

export function computeSnap(
  rawStartMs: number,
  candidates: SnapCandidate[],
  pxPerSecond: number,
  thresholdPx: number,
): SnapResult {
  const thresholdMs = (thresholdPx / pxPerSecond) * 1000;
  let best: SnapCandidate | null = null;
  let bestDistMs = Infinity;
  for (const cand of candidates) {
    const dist = Math.abs(cand.ms - rawStartMs);
    if (dist > thresholdMs) continue;
    if (
      dist < bestDistMs ||
      (dist === bestDistMs && best && PRIORITY[cand.kind] > PRIORITY[best.kind])
    ) {
      best = cand;
      bestDistMs = dist;
    }
  }
  if (!best) return { snappedStartMs: rawStartMs, snapTarget: null };
  return { snappedStartMs: best.ms, snapTarget: best.kind };
}
