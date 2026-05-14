"use client";

import { useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { mutateOverlay, removeOverlay } from "@/lib/overlay/overlay-store";
import { applyStyleToAll } from "@/lib/text-overlay/text-overlay-store";
import { AVAILABLE_FONTS } from "@/lib/text-overlay/text-style-defaults";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import type { TextStyle } from "@/lib/text-overlay/text-overlay-types";

interface Props { overlayId: string }

const STYLE_KEYS: (keyof TextStyle)[] = [
  "fontFamily", "fontWeight", "fontSizeFrac", "textColor",
  "bgEnabled", "bgColor", "bgOpacity", "bgPaddingXFrac", "bgPaddingYFrac", "bgRadiusFrac",
  "strokeEnabled", "strokeColor", "strokeWidthFrac",
  "alignment", "positionXFrac", "positionYFrac", "maxWidthFrac",
];

export function TextOverlayInspector({ overlayId }: Props) {
  const {
    overlays, setOverlays, setSelectedOverlayId,
    textOverlayApplyAll, setTextOverlayApplyAll,
  } = useBuildState();
  const overlay = overlays.find((o) => o.id === overlayId && o.kind === "text") as TextOverlay | undefined;

  useEffect(() => {
    if (!overlay) setSelectedOverlayId(null);
  }, [overlay, setSelectedOverlayId]);

  if (!overlay) return null;

  function onPatchSingle(patch: Partial<TextOverlay>) {
    setOverlays((prev) => mutateOverlay(prev, overlay!.id, patch));
  }
  function onPatchStyle(patch: Partial<TextStyle>) {
    if (textOverlayApplyAll) {
      const styleOnly: Partial<TextStyle> = {};
      for (const k of STYLE_KEYS) {
        if (k in patch) {
          (styleOnly as unknown as Record<string, unknown>)[k] =
            (patch as unknown as Record<string, unknown>)[k];
        }
      }
      setOverlays((prev) => applyStyleToAll(prev, styleOnly));
    } else {
      setOverlays((prev) => mutateOverlay(prev, overlay!.id, patch as Partial<TextOverlay>));
    }
  }
  function onDelete() {
    setOverlays((prev) => removeOverlay(prev, overlay!.id));
    setSelectedOverlayId(null);
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-3 text-xs gap-3">
      <label className="flex items-center gap-2 pb-2 border-b border-border">
        <input
          type="checkbox"
          checked={textOverlayApplyAll}
          onChange={(e) => setTextOverlayApplyAll(e.target.checked)}
        />
        <span className="font-medium">Apply to all main captions</span>
      </label>

      <div className="space-y-1">
        <span className="block">Text</span>
        <textarea
          value={overlay.text}
          onChange={(e) => onPatchSingle({ text: e.target.value })}
          rows={3}
          className="w-full px-2 py-1.5 rounded bg-muted/40 border border-border resize-y"
        />
      </div>

      <div className="space-y-1">
        <span className="block">Font</span>
        <select
          value={overlay.fontFamily}
          onChange={(e) => onPatchStyle({ fontFamily: e.target.value as TextStyle["fontFamily"] })}
          className="w-full px-2 py-1 rounded bg-muted/40 border border-border"
        >
          {AVAILABLE_FONTS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Font size</span>
          <span className="font-mono">{Math.round(overlay.fontSizeFrac * 100)}%</span>
        </div>
        <input
          type="range" min={2} max={15} step={1}
          value={Math.round(overlay.fontSizeFrac * 100)}
          onChange={(e) => onPatchStyle({ fontSizeFrac: Number(e.target.value) / 100 })}
          className="w-full"
        />
      </div>

      <div className="space-y-1">
        <span className="block">Text color</span>
        <input
          type="color"
          value={overlay.textColor}
          onChange={(e) => onPatchStyle({ textColor: e.target.value })}
          className="h-7 w-12 border border-border rounded"
        />
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={overlay.bgEnabled}
            onChange={(e) => onPatchStyle({ bgEnabled: e.target.checked })}
          />
          <span className="font-medium">Background</span>
        </label>
        {overlay.bgEnabled && (
          <div className="space-y-1.5 pl-5">
            <div className="flex items-center gap-2">
              <span>Color</span>
              <input
                type="color"
                value={overlay.bgColor}
                onChange={(e) => onPatchStyle({ bgColor: e.target.value })}
                className="h-7 w-10 border border-border rounded"
              />
            </div>
            <div>
              <div className="flex justify-between"><span>Opacity</span><span className="font-mono">{Math.round(overlay.bgOpacity * 100)}%</span></div>
              <input type="range" min={0} max={100} step={5}
                value={Math.round(overlay.bgOpacity * 100)}
                onChange={(e) => onPatchStyle({ bgOpacity: Number(e.target.value) / 100 })}
                className="w-full" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={overlay.strokeEnabled}
            onChange={(e) => onPatchStyle({ strokeEnabled: e.target.checked })}
          />
          <span className="font-medium">Outline</span>
        </label>
        {overlay.strokeEnabled && (
          <div className="space-y-1.5 pl-5">
            <div className="flex items-center gap-2">
              <span>Color</span>
              <input
                type="color"
                value={overlay.strokeColor}
                onChange={(e) => onPatchStyle({ strokeColor: e.target.value })}
                className="h-7 w-10 border border-border rounded"
              />
            </div>
            <div>
              <div className="flex justify-between"><span>Width</span><span className="font-mono">{(overlay.strokeWidthFrac * 100).toFixed(1)}%</span></div>
              <input type="range" min={1} max={20} step={1}
                value={Math.round(overlay.strokeWidthFrac * 1000)}
                onChange={(e) => onPatchStyle({ strokeWidthFrac: Number(e.target.value) / 1000 })}
                className="w-full" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <div className="flex justify-between"><span>Y position</span><span className="font-mono">{Math.round(overlay.positionYFrac * 100)}%</span></div>
        <input type="range" min={5} max={95} step={1}
          value={Math.round(overlay.positionYFrac * 100)}
          onChange={(e) => onPatchStyle({ positionYFrac: Number(e.target.value) / 100 })}
          className="w-full" />
        <div className="flex justify-between"><span>X position</span><span className="font-mono">{Math.round(overlay.positionXFrac * 100)}%</span></div>
        <input type="range" min={5} max={95} step={1}
          value={Math.round(overlay.positionXFrac * 100)}
          onChange={(e) => onPatchStyle({ positionXFrac: Number(e.target.value) / 100 })}
          className="w-full" />
        <div className="flex justify-between"><span>Max width</span><span className="font-mono">{Math.round(overlay.maxWidthFrac * 100)}%</span></div>
        <input type="range" min={30} max={100} step={5}
          value={Math.round(overlay.maxWidthFrac * 100)}
          onChange={(e) => onPatchStyle({ maxWidthFrac: Number(e.target.value) / 100 })}
          className="w-full" />
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto w-full flex items-center justify-center gap-1 py-1.5 text-red-400 hover:bg-red-500/10 rounded border border-red-500/30"
      >
        <Trash2 className="w-3 h-3" />
        Delete
      </button>
    </div>
  );
}
