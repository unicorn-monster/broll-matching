export interface OverlayBase {
  id: string;
  kind: string;
  trackIndex: number;
  startMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface BrollVideoOverlay extends OverlayBase {
  kind: "broll-video";
  clipId: string;
  indexeddbKey: string;
  sourceStartMs: number;
  sourceDurationMs: number;
}

// Future: add AudioFxOverlay (kind: "audio-fx") and TextOverlay (kind: "text") here and to OverlayItem union.

export type OverlayItem = BrollVideoOverlay;
export type OverlayKind = OverlayItem["kind"];
