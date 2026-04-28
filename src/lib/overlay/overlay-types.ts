// src/lib/overlay/overlay-types.ts

export type OverlayKind = "broll-video" | "audio-fx" | "text";

export interface OverlayBase {
  id: string;
  kind: OverlayKind;
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

// Future kinds (defined here so the render switch stays exhaustive when added):
// export interface AudioFxOverlay extends OverlayBase { kind: "audio-fx"; ... }
// export interface TextOverlay   extends OverlayBase { kind: "text";      ... }

export type OverlayItem = BrollVideoOverlay;
