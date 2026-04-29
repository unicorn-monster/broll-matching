import type { OverlayItem } from "./overlay-types";

export function listTracks(overlays: OverlayItem[]): number[] {
  return Array.from(new Set(overlays.map((o) => o.trackIndex))).sort((a, b) => a - b);
}

export function maxTrackIndex(overlays: OverlayItem[]): number {
  if (overlays.length === 0) return -1;
  return overlays.reduce((m, o) => (o.trackIndex > m ? o.trackIndex : m), -Infinity);
}

export interface TrackBand {
  trackIndex: number;
  top: number;
  bottom: number;
}

export interface TopZone {
  topZoneTop: number;
  topZoneBottom: number;
}

export type PickResult = { mode: "create" | "into"; trackIndex: number };

export function pickTrack(
  mouseY: number,
  trackBands: TrackBand[],
  topZone: TopZone,
  currentMaxTrackIndex: number,
): PickResult {
  if (mouseY >= topZone.topZoneTop && mouseY < topZone.topZoneBottom) {
    return { mode: "create", trackIndex: currentMaxTrackIndex + 1 };
  }
  for (const band of trackBands) {
    if (mouseY >= band.top && mouseY < band.bottom) {
      return { mode: "into", trackIndex: band.trackIndex };
    }
  }
  // Fallback: empty timeline → create track 0
  return { mode: "create", trackIndex: Math.max(0, currentMaxTrackIndex + 1) };
}
