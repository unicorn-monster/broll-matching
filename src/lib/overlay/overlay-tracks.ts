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

export interface CreateZone {
  top: number;
  bottom: number;
  newTrackIndex: number;
}

export type PickResult = { mode: "create" | "into"; trackIndex: number };

export function pickTrack(
  mouseY: number,
  trackBands: TrackBand[],
  createZones: CreateZone[],
  fallbackMaxTrackIndex: number,
): PickResult {
  for (const zone of createZones) {
    if (mouseY >= zone.top && mouseY < zone.bottom) {
      return { mode: "create", trackIndex: zone.newTrackIndex };
    }
  }
  for (const band of trackBands) {
    if (mouseY >= band.top && mouseY < band.bottom) {
      return { mode: "into", trackIndex: band.trackIndex };
    }
  }
  return { mode: "create", trackIndex: Math.max(0, fallbackMaxTrackIndex + 1) };
}
