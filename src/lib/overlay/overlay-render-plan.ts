import type { BrollVideoOverlay, OverlayItem } from "./overlay-types";

export function findActiveOverlays(
  overlays: OverlayItem[],
  ms: number,
): BrollVideoOverlay[] {
  const brolls = overlays.filter((o): o is BrollVideoOverlay => o.kind === "broll-video");
  return brolls.filter((o) => ms >= o.startMs && ms < o.startMs + o.durationMs);
}

export function findTopmostActive(
  overlays: OverlayItem[],
  ms: number,
): BrollVideoOverlay | null {
  const active = findActiveOverlays(overlays, ms);
  if (active.length === 0) return null;
  return active.reduce((max, o) => (o.trackIndex > max.trackIndex ? o : max), active[0]!);
}

export function computeFadedVolume(o: OverlayItem, audioMs: number): number {
  const localMs = audioMs - o.startMs;
  let factor = 1;
  if (o.fadeInMs > 0 && localMs < o.fadeInMs) {
    factor = Math.max(0, localMs / o.fadeInMs);
  }
  const fadeOutStart = o.durationMs - o.fadeOutMs;
  if (o.fadeOutMs > 0 && localMs > fadeOutStart) {
    factor = Math.max(0, (o.durationMs - localMs) / o.fadeOutMs);
  }
  return Math.min(1, Math.max(0, o.volume * factor));
}
