"use client";

import { useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { mutateOverlay, removeOverlay, compactTracks } from "@/lib/overlay/overlay-store";
import { useMediaPool } from "@/state/media-pool";
import { formatMs } from "@/lib/format-time";

interface OverlayInspectorProps {
  overlayId: string;
}

export function OverlayInspector({ overlayId }: OverlayInspectorProps) {
  const { overlays, setOverlays, setSelectedOverlayId } = useBuildState();
  const overlay = overlays.find((o) => o.id === overlayId) ?? null;

  const mediaPool = useMediaPool();
  // Synchronous lookup — pool manages URL lifetime, no cleanup needed
  const thumbUrl = overlay?.kind === "broll-video" ? mediaPool.getFileURL(overlay.fileId) : null;

  useEffect(() => {
    if (overlay === null) setSelectedOverlayId(null);
  }, [overlay, setSelectedOverlayId]);

  if (!overlay) return null;

  function onPatch(patch: Partial<NonNullable<typeof overlay>>) {
    if (!overlay) return;
    setOverlays((prev) => mutateOverlay(prev, overlay.id, patch));
  }

  function onDelete() {
    if (!overlay) return;
    setOverlays((prev) => compactTracks(removeOverlay(prev, overlay.id)));
    setSelectedOverlayId(null);
  }

  const volumePct = Math.round(overlay.volume * 100);

  return (
    <div className="h-full flex flex-col overflow-y-auto p-3 text-xs gap-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <div className="w-12 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0">
          {thumbUrl && (
            // Video shows first frame automatically when paused/not playing
            <video src={thumbUrl} preload="metadata" muted playsInline className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">
            {overlay.kind === "broll-video" ? overlay.clipId.slice(0, 12) : overlay.kind}
          </div>
          <div className="text-muted-foreground text-[10px]">
            Source: {formatMs(overlay.sourceDurationMs)}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Volume</span>
          <span className="font-mono">{volumePct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumePct}
          disabled={overlay.muted}
          onChange={(e) => onPatch({ volume: Number(e.target.value) / 100 })}
          className="w-full"
        />
        <label className="flex items-center gap-2 mt-1">
          <input
            type="checkbox"
            checked={overlay.muted}
            onChange={(e) => onPatch({ muted: e.target.checked })}
          />
          Mute
        </label>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Fade in</span>
          <span className="font-mono">{(overlay.fadeInMs / 1000).toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0}
          max={2000}
          step={100}
          value={overlay.fadeInMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            const clamped = Math.min(v, overlay.durationMs - overlay.fadeOutMs);
            onPatch({ fadeInMs: Math.max(0, clamped) });
          }}
          className="w-full"
        />
        <div className="flex justify-between">
          <span>Fade out</span>
          <span className="font-mono">{(overlay.fadeOutMs / 1000).toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0}
          max={2000}
          step={100}
          value={overlay.fadeOutMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            const clamped = Math.min(v, overlay.durationMs - overlay.fadeInMs);
            onPatch({ fadeOutMs: Math.max(0, clamped) });
          }}
          className="w-full"
        />
      </div>

      <div className="space-y-0.5 pt-2 border-t border-border text-muted-foreground">
        <div className="flex justify-between">
          <span>Start</span>
          <span className="font-mono">{formatMs(overlay.startMs)}</span>
        </div>
        <div className="flex justify-between">
          <span>Duration</span>
          <span className="font-mono">{formatMs(overlay.durationMs)}</span>
        </div>
        <div className="flex justify-between">
          <span>Track</span>
          <span className="font-mono">V{overlay.trackIndex}</span>
        </div>
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
