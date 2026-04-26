"use client";

import { Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGH_SPEED_THRESHOLD, type MatchedSection } from "@/lib/auto-match";

interface TrackTagsProps {
  timeline: MatchedSection[];
  pxPerSecond: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function TrackTags({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackTagsProps) {
  let cursor = 0;
  return (
    <div className="relative h-10 flex items-stretch">
      {timeline.map((s, i) => {
        const left = cursor;
        const width = (s.durationMs / 1000) * pxPerSecond;
        cursor += width;
        const isMissing = s.clips.some((c) => c.isPlaceholder);
        const isHighSpeed =
          s.clips.length > 0 && Math.max(...s.clips.map((c) => c.speedFactor)) > HIGH_SPEED_THRESHOLD;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "absolute top-1 bottom-1 px-1.5 rounded-sm border text-[10px] font-medium truncate flex items-center gap-1 transition",
              isMissing && "bg-red-500/10 border-red-500/40 border-dashed text-red-300",
              !isMissing && s.userLocked && "bg-blue-500/15 border-blue-500/50 text-blue-200",
              !isMissing && !s.userLocked && isHighSpeed && "bg-yellow-500/15 border-yellow-500/50 text-yellow-200",
              !isMissing && !s.userLocked && !isHighSpeed && "bg-primary/15 border-primary/40 text-primary",
              i === selectedIndex && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
            title={`[${s.tag}] ${s.durationMs}ms`}
          >
            <span className="truncate">{s.tag}</span>
            {s.userLocked && <Lock className="w-2.5 h-2.5 shrink-0" />}
            {isHighSpeed && <AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
