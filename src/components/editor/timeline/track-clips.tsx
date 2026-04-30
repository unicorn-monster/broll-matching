"use client";

import { cn } from "@/lib/utils";
import { useMediaPool } from "@/state/media-pool";
import type { MatchedSection } from "@/lib/auto-match";

interface TrackClipsProps {
  timeline: MatchedSection[];
  pxPerSecond: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function TrackClips({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackClipsProps) {
  let cursor = 0;
  return (
    <div className="relative h-[90px] flex items-stretch bg-muted/10">
      {timeline.map((section, i) => {
        const left = cursor;
        const width = (section.durationMs / 1000) * pxPerSecond;
        cursor += width;
        return (
          <div
            key={i}
            data-clip-block
            onClick={() => onSelect(i)}
            className={cn(
              "absolute top-1 bottom-1 rounded-sm border overflow-hidden flex gap-px cursor-pointer",
              section.userLocked ? "border-blue-500/50" : "border-border/50",
              section.clips.some((c) => c.isPlaceholder) && "border-red-500/40 border-dashed bg-red-500/5",
              i === selectedIndex && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
          >
            {section.clips.map((c, j) =>
              c.isPlaceholder ? (
                <div key={j} className="flex-1 min-w-0 flex items-center justify-center text-red-400 text-xs">▣</div>
              ) : (
                <ClipThumb
                  key={j}
                  thumbKey={c.fileId}
                  speedFactor={c.speedFactor}
                  trimDurationMs={c.trimDurationMs}
                  sectionMs={section.durationMs}
                />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClipThumb({
  thumbKey,
  speedFactor,
  trimDurationMs,
  sectionMs,
}: {
  thumbKey: string;
  speedFactor: number;
  trimDurationMs?: number | undefined;
  sectionMs: number;
}) {
  const mediaPool = useMediaPool();
  // Synchronous lookup — pool manages URL lifetime, no cleanup needed
  const src = mediaPool.getFileURL(thumbKey);

  const isTrim = trimDurationMs != null;
  const tooltip = isTrim
    ? `Trimmed to ${(sectionMs / 1000).toFixed(2)}s (1× speed)`
    : `${speedFactor.toFixed(2)}× speed`;

  return (
    <div className="relative flex-1 min-w-0 bg-black/40" title={tooltip}>
      {src && (
        // Video shows first frame automatically when paused/not playing
        <video src={src} preload="metadata" muted playsInline className="absolute inset-0 w-full h-full object-cover" />
      )}
      {isTrim ? (
        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1">
          1× ✂
        </span>
      ) : speedFactor !== 1 ? (
        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1">
          {speedFactor.toFixed(2)}×
        </span>
      ) : null}
    </div>
  );
}
