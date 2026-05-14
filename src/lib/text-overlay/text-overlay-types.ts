export type { TextOverlay } from "@/lib/overlay/overlay-types";

export type TextStyle = {
  fontFamily: "Inter";
  fontWeight: 400 | 700;
  fontSizeFrac: number;
  textColor: string;
  bgEnabled: boolean;
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
};

export const TEXT_OVERLAY_APPLY_ALL_PREF_KEY = "text-overlay-apply-all";
