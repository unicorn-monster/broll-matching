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
  fileId: string;
  sourceStartMs: number;
  sourceDurationMs: number;
}

export interface TextOverlay extends OverlayBase {
  kind: "text";
  text: string;
  source: "auto-script" | "manual";
  sectionLineNumber?: number;
  // Style (all numbers are 0..1 fractions of output dimensions where applicable).
  fontFamily: "Inter" | "Roboto" | "Open Sans";
  fontWeight: 400 | 500 | 600 | 700;
  fontSizeFrac: number;
  textColor: string;
  bgMode: "none" | "block" | "per-line";
  bgColor: string;
  bgOpacity: number;
  bgPaddingXFrac: number;
  bgPaddingYFrac: number;
  bgRadiusFrac: number;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidthFrac: number;
  alignment: "left" | "center" | "right";
  positionXFrac: number;
  positionYFrac: number;
  maxWidthFrac: number;
}

export type OverlayItem = BrollVideoOverlay | TextOverlay;
export type OverlayKind = OverlayItem["kind"];
