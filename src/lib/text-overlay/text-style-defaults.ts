import type { TextStyle } from "./text-overlay-types";

export const TEXT_OVERLAY_DEFAULT_DURATION_MS = 2000;
export const TEXT_OVERLAY_SNAP_AXES = [0.1, 0.5, 0.9] as const;
export const TEXT_OVERLAY_SNAP_THRESHOLD_PX = 12;
export const TEXT_OVERLAY_DEFAULT_TRACK_INDEX = 0;

// Captions are shifted earlier by this offset. Set to 0 to match the script timestamps
// exactly (user feedback: 150ms lead was still perceptible as too early).
export const TEXT_OVERLAY_LEAD_MS = 0;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Inter",
  fontWeight: 500,
  fontSizeFrac: 0.05,
  textColor: "#000000",
  bgMode: "per-line",
  bgColor: "#ffffff",
  bgOpacity: 1,
  bgPaddingXFrac: 0.015,
  bgPaddingYFrac: 0.008,
  bgRadiusFrac: 0.2,
  strokeEnabled: false,
  strokeColor: "#000000",
  strokeWidthFrac: 0.003,
  alignment: "center",
  positionXFrac: 0.5,
  positionYFrac: 0.85,
  maxWidthFrac: 0.8,
};

export const AVAILABLE_FONTS = [
  { id: "Inter" as const, label: "Classic" },
  { id: "Roboto" as const, label: "Roboto" },
  { id: "Open Sans" as const, label: "Open Sans" },
];
