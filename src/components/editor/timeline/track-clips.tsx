"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/format-time";
import { useMediaPool } from "@/state/media-pool";
import { useBuildState } from "@/components/build/build-state-context";
import type { MatchedSection } from "@/lib/auto-match";

interface TrackClipsProps {
  timeline: MatchedSection[];
  pxPerSecond: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function TrackClips({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackClipsProps) {
  const { talkingHeadFile } = useBuildState();
  return (
    <div className="relative h-[90px] flex items-stretch bg-muted/10">
      {timeline.map((section, i) => {
        const left = (section.startMs / 1000) * pxPerSecond;
        const width = (section.durationMs / 1000) * pxPerSecond;
        const isTalkingHead = section.clips.some((c) => c.sourceSeekMs !== undefined);
        return (
          <div
            key={i}
            data-clip-block
            onClick={() => onSelect(i)}
            className={cn(
              "absolute top-1 bottom-1 rounded-sm border overflow-hidden flex gap-px cursor-pointer",
              section.userLocked ? "border-blue-500/50" : "border-border/50",
              section.clips.some((c) => c.isPlaceholder) && "border-red-500/40 border-dashed bg-red-500/5",
              isTalkingHead && "border-purple-500/60 bg-purple-500/5",
              i === selectedIndex && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
          >
            {section.clips.map((c, j) =>
              c.sourceSeekMs !== undefined ? (
                talkingHeadFile
                  ? <TalkingHeadThumb
                      key={j}
                      file={talkingHeadFile}
                      sourceSeekMs={c.sourceSeekMs}
                      trimDurationMs={c.trimDurationMs}
                    />
                  : <div
                      key={j}
                      className="relative flex-1 min-w-0 bg-purple-500/15 flex items-center justify-center text-purple-200 text-[10px] font-semibold"
                      title={`Talking-head ${formatMs(c.sourceSeekMs)} → ${formatMs(c.sourceSeekMs + (c.trimDurationMs ?? 0))}`}
                    >
                      TH
                    </div>
              ) : c.isPlaceholder ? (
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

function TalkingHeadThumb({
  file,
  sourceSeekMs,
  trimDurationMs,
}: {
  file: File;
  sourceSeekMs: number;
  trimDurationMs?: number | undefined;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/talking-head-thumbnail").then(({ getTalkingHeadThumbnail }) =>
      getTalkingHeadThumbnail(file, sourceSeekMs).then((u) => {
        if (!cancelled) setUrl(u);
      }),
    ).catch(() => { /* ignore — fallback to badge */ });
    return () => { cancelled = true; };
  }, [file, sourceSeekMs]);
  const tooltip = `Talking-head ${formatMs(sourceSeekMs)} → ${formatMs(sourceSeekMs + (trimDurationMs ?? 0))}`;
  return url
    ? <div className="relative flex-1 min-w-0 bg-black/40" title={tooltip}>
        <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>
    : <div
        className="relative flex-1 min-w-0 bg-purple-500/15 flex items-center justify-center text-purple-200 text-[10px] font-semibold"
        title={tooltip}
      >
        TH
      </div>;
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
