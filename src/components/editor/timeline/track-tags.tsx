"use client";

import { Lock, LockOpen, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGH_SPEED_THRESHOLD, type MatchedSection } from "@/lib/auto-match";

interface TrackTagsProps {
  timeline: MatchedSection[];
  pxPerSecond: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onToggleLock: (index: number) => void;
}

export function TrackTags({ timeline, pxPerSecond, selectedIndex, onSelect, onToggleLock }: TrackTagsProps) {
  return (
    <div className="relative h-10 flex items-stretch">
      {timeline.map((s, i) => {
        const left = (s.startMs / 1000) * pxPerSecond;
        const width = (s.durationMs / 1000) * pxPerSecond;
        const isMissing = s.clips.some((c) => c.isPlaceholder);
        const isTalkingHead = s.clips.some((c) => c.sourceSeekMs !== undefined);
        const isHighSpeed =
          s.clips.length > 0 && Math.max(...s.clips.map((c) => c.speedFactor)) > HIGH_SPEED_THRESHOLD;
        const canLock = !isMissing && !isTalkingHead;
        return (
          <div
            key={i}
            className={cn(
              "absolute top-1 bottom-1 rounded-sm border text-[10px] font-medium flex items-center transition overflow-hidden",
              isMissing && "bg-red-500/10 border-red-500/40 border-dashed text-red-300",
              !isMissing && s.userLocked && "bg-blue-500/15 border-blue-500/50 text-blue-200",
              !isMissing && !s.userLocked && isHighSpeed && "bg-yellow-500/15 border-yellow-500/50 text-yellow-200",
              !isMissing && !s.userLocked && !isHighSpeed && "bg-primary/15 border-primary/40 text-primary",
              i === selectedIndex && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
            title={`[${s.tag}] ${s.durationMs}ms`}
          >
            <button
              type="button"
              onClick={() => onSelect(i)}
              className="flex-1 min-w-0 px-1.5 h-full flex items-center gap-1 truncate text-left"
            >
              <span className="truncate">{s.tag}</span>
              {isHighSpeed && <AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
            </button>
            {canLock ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleLock(i); }}
                className={cn(
                  "shrink-0 h-full px-1 flex items-center transition",
                  s.userLocked ? "text-blue-200 hover:text-blue-100" : "text-current/40 hover:text-current/80",
                )}
                aria-label={s.userLocked ? "Unlock this section (allow shuffle)" : "Lock this section (preserve on shuffle)"}
                title={s.userLocked ? "Unlock — allow shuffle to re-roll this section" : "Lock — preserve this pick on shuffle"}
              >
                {s.userLocked ? <Lock className="w-2.5 h-2.5" /> : <LockOpen className="w-2.5 h-2.5" />}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
