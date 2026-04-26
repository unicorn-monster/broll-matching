"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
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
                <ClipThumb key={j} clipId={c.clipId} speedFactor={c.speedFactor} />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClipThumb({ clipId, speedFactor }: { clipId: string; speedFactor: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let active = true;
    getThumbnail(clipId).then((buf) => {
      if (!active || !buf) return;
      url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      setSrc(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [clipId]);
  return (
    <div className="relative flex-1 min-w-0 bg-black/40">
      {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {speedFactor !== 1 && (
        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1">
          {speedFactor.toFixed(1)}×
        </span>
      )}
    </div>
  );
}
