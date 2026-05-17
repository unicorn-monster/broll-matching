"use client";

import { useMemo, useState } from "react";
import { PictureInPicture } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuildState } from "@/components/build/build-state-context";
import { OVERLAY_TAG } from "@/lib/script-parser";
import { sectionKey } from "@/lib/matting/section-key";

interface Props {
  pxPerSecond: number;
}

const ROW_HEIGHT = 28;

/**
 * Per-shot row for talking-head OVERLAY sections. One chip per script section
 * tagged with OVERLAY_TAG, positioned on the timeline by its start/duration in ms.
 *
 * Interactions:
 * - Click → select chip (local-only highlight; selection is not shared with the
 *   section/overlay inspector because per-shot disable is a row-scoped action).
 * - Delete / Backspace on a focused chip → toggle the shot's entry in
 *   `disabledOverlayShots`. A disabled chip is dimmed + line-through; pressing
 *   Delete again restores it.
 *
 * Returns null when there are no overlay shots so the timeline doesn't reserve
 * a blank row.
 */
export function TrackOverlayShots({ pxPerSecond }: Props) {
  const { sections, disabledOverlayShots, disableOverlayShot, restoreOverlayShot } = useBuildState();
  const [selectedShotKey, setSelectedShotKey] = useState<string | null>(null);

  // Derive overlay shots from the parsed script, not the matched timeline:
  // MatchedSection only carries the single base tag, while ParsedSection retains
  // the full tag list including the synthetic overlay tag. ParsedSection times
  // are in seconds; convert to ms to align with sectionKey's contract (same
  // convention used by auto-match.ts and build-state-context.tsx).
  const overlayShots = useMemo(() => {
    if (!sections) return [];
    return sections
      .filter((s) => s.tags.includes(OVERLAY_TAG))
      .map((s) => {
        const startMs = s.startTime * 1000;
        const endMs = s.endTime * 1000;
        return { startMs, endMs, durationMs: endMs - startMs };
      });
  }, [sections]);

  if (overlayShots.length === 0) return null;

  return (
    <div className="relative bg-muted/5 border-b border-border/30" style={{ height: `${ROW_HEIGHT}px` }}>
      {overlayShots.map((s) => {
        const k = sectionKey({ startMs: s.startMs, endMs: s.endMs });
        const disabled = disabledOverlayShots.has(k);
        const selected = selectedShotKey === k;
        const left = (s.startMs / 1000) * pxPerSecond;
        const width = Math.max(8, (s.durationMs / 1000) * pxPerSecond);
        return (
          <div
            key={k}
            role="button"
            tabIndex={0}
            data-overlay-block
            data-kind="overlay-shot"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedShotKey(k);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                if (disabled) restoreOverlayShot(k);
                else disableOverlayShot(k);
              }
            }}
            className={cn(
              "absolute top-1 bottom-1 rounded-md border text-[10px] font-medium flex items-center gap-1 px-1.5 select-none overflow-hidden cursor-pointer outline-none",
              "bg-purple-500/15 border-purple-500/40 text-purple-200",
              disabled && "opacity-40 line-through",
              selected && "ring-2 ring-purple-400 ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${width}px` }}
            title={
              disabled
                ? `Overlay shot disabled (${k}) — Delete to restore`
                : `Overlay shot (${k}) — Delete to disable`
            }
          >
            <PictureInPicture className="w-3 h-3 shrink-0" />
            <span className="truncate font-mono">{k}</span>
          </div>
        );
      })}
    </div>
  );
}
