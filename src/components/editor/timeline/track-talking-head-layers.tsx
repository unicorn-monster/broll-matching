"use client";

import { useEffect, useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuildState } from "@/components/build/build-state-context";
import type { MatchedSection } from "@/lib/auto-match";
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

interface RowProps {
  layer: TalkingHeadLayer;
  layerUrl: string | undefined;
  timeline: MatchedSection[] | null;
  pxPerSecond: number;
  selectedSectionIndex: number | null;
  onSelectSection: (i: number) => void;
  onRemoveLayer: (id: string) => void;
}

function LayerRow({
  layer,
  layerUrl,
  timeline,
  pxPerSecond,
  selectedSectionIndex,
  onSelectSection,
  onRemoveLayer,
}: RowProps) {
  const matches = (timeline ?? []).filter((s) => s.tag.toLowerCase() === layer.tag);
  return (
    <div className="relative h-[90px] flex items-stretch bg-muted/10 border-b border-border/30 group">
      {/* Sparse video-thumbnail blocks at each matching section's time range. */}
      {matches.map((s) => {
        const left = (s.startMs / 1000) * pxPerSecond;
        const width = (s.durationMs / 1000) * pxPerSecond;
        const isSelected = timeline?.[selectedSectionIndex ?? -1] === s;
        return (
          <button
            key={s.sectionIndex}
            type="button"
            data-clip-block
            onClick={() => onSelectSection(s.sectionIndex)}
            className={cn(
              "absolute top-1 bottom-1 rounded-sm border overflow-hidden",
              "border-purple-500/60 bg-purple-500/5",
              isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
            title={`${layer.tag} · ${(s.durationMs / 1000).toFixed(2)}s`}
          >
            {layerUrl ? (
              <video
                src={layerUrl}
                preload="metadata"
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : null}
            <span className="absolute top-1 left-1 bg-black/60 text-purple-200 text-[9px] font-mono px-1 py-0.5 rounded-sm">
              {layer.tag}
            </span>
          </button>
        );
      })}
      {/* Empty-state header pinned left when no matches */}
      {matches.length === 0 && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-2 text-[11px] font-mono text-purple-300/80">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
          <span>{layer.tag}</span>
          <span className="italic text-muted-foreground">— no matching section</span>
        </div>
      )}
      {/* Hover delete button (top-right) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemoveLayer(layer.id);
        }}
        className="absolute top-1 right-1 z-10 p-1 rounded-sm bg-background/70 backdrop-blur-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
        aria-label={`Delete talking-head layer ${layer.tag}`}
        title={`Delete layer "${layer.tag}"`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function TrackTalkingHeadLayers({ pxPerSecond }: { pxPerSecond: number }) {
  const {
    talkingHeadLayers,
    talkingHeadFiles,
    timeline,
    selectedSectionIndex,
    setSelectedSectionIndex,
    removeTalkingHeadLayer,
  } = useBuildState();

  // ObjectURLs for each layer's MP4 — keyed by fileId, rebuilt when the files Map changes.
  const [thUrls, setThUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const [fileId, file] of talkingHeadFiles) next.set(fileId, URL.createObjectURL(file));
    setThUrls(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [talkingHeadFiles]);

  if (talkingHeadLayers.length === 0) return null;

  return (
    <div>
      {talkingHeadLayers.map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          layerUrl={thUrls.get(layer.fileId)}
          timeline={timeline}
          pxPerSecond={pxPerSecond}
          selectedSectionIndex={selectedSectionIndex}
          onSelectSection={setSelectedSectionIndex}
          onRemoveLayer={removeTalkingHeadLayer}
        />
      ))}
    </div>
  );
}
