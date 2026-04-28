// src/lib/overlay/overlay-store.ts
import type { OverlayItem } from "./overlay-types";

export function addOverlay(overlays: OverlayItem[], next: OverlayItem): OverlayItem[] {
  return [...overlays, next];
}

export function addOverlayWithNewTrack(
  overlays: OverlayItem[],
  next: OverlayItem,
): OverlayItem[] {
  const shifted = overlays.map((o) =>
    o.trackIndex >= next.trackIndex ? { ...o, trackIndex: o.trackIndex + 1 } : o,
  );
  return [...shifted, next];
}

export function removeOverlay(overlays: OverlayItem[], id: string): OverlayItem[] {
  return overlays.filter((o) => o.id !== id);
}

export function moveOverlay(
  overlays: OverlayItem[],
  id: string,
  patch: { startMs: number; trackIndex: number },
): OverlayItem[] {
  return overlays.map((o) =>
    o.id === id ? { ...o, startMs: patch.startMs, trackIndex: patch.trackIndex } : o,
  );
}

export function splitOverlayAtMs(
  overlays: OverlayItem[],
  id: string,
  atMs: number,
): OverlayItem[] {
  const o = overlays.find((x) => x.id === id);
  if (!o) return overlays;
  const localMs = atMs - o.startMs;
  if (localMs <= 0 || localMs >= o.durationMs) return overlays;

  const left: OverlayItem = { ...o, durationMs: localMs };
  const right: OverlayItem = {
    ...o,
    id: crypto.randomUUID(),
    startMs: atMs,
    durationMs: o.durationMs - localMs,
    sourceStartMs: o.sourceStartMs + localMs,
  };
  return overlays.map((x) => (x.id === id ? left : x)).concat(right);
}

export function mutateOverlay(
  overlays: OverlayItem[],
  id: string,
  patch: Partial<OverlayItem>,
): OverlayItem[] {
  return overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as OverlayItem) : o));
}

export function compactTracks(overlays: OverlayItem[]): OverlayItem[] {
  const usedIndices = Array.from(new Set(overlays.map((o) => o.trackIndex))).sort(
    (a, b) => a - b,
  );
  const remap = new Map<number, number>();
  usedIndices.forEach((idx, newIdx) => remap.set(idx, newIdx));
  return overlays.map((o) => ({ ...o, trackIndex: remap.get(o.trackIndex) ?? o.trackIndex }));
}
