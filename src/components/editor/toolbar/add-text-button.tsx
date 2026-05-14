"use client";

import { Type as TypeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { addManualTextOverlay } from "@/lib/text-overlay/text-overlay-store";
import { DEFAULT_TEXT_STYLE } from "@/lib/text-overlay/text-style-defaults";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import type { TextStyle } from "@/lib/text-overlay/text-overlay-types";

const TEXT_STYLE_KEYS: (keyof TextStyle)[] = [
  "fontFamily", "fontWeight", "fontSizeFrac", "textColor",
  "bgEnabled", "bgColor", "bgOpacity", "bgPaddingXFrac", "bgPaddingYFrac", "bgRadiusFrac",
  "strokeEnabled", "strokeColor", "strokeWidthFrac",
  "alignment", "positionXFrac", "positionYFrac", "maxWidthFrac",
];

function styleFromLastEdited(overlays: TextOverlay[]): TextStyle {
  if (overlays.length === 0) return DEFAULT_TEXT_STYLE;
  const last = overlays[overlays.length - 1]!;
  const style = {} as TextStyle;
  const lastRecord = last as unknown as Record<string, unknown>;
  const styleRecord = style as unknown as Record<string, unknown>;
  for (const k of TEXT_STYLE_KEYS) {
    styleRecord[k] = lastRecord[k];
  }
  return style;
}

export function AddTextButton() {
  const { overlays, setOverlays, playheadMs, setSelectedOverlayId } = useBuildState();

  function onClick() {
    const existingText = overlays.filter((o): o is TextOverlay => o.kind === "text");
    const style = styleFromLastEdited(existingText);
    setOverlays((prev) => {
      const next = addManualTextOverlay(prev, playheadMs, style);
      const added = next[next.length - 1]!;
      queueMicrotask(() => setSelectedOverlayId(added.id));
      return next;
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick} title="Add text overlay at playhead">
      <TypeIcon className="w-3.5 h-3.5 mr-1" />
      Add text
    </Button>
  );
}
