"use client";

import { Trash2, AlertTriangle } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import type { MatchedSection } from "@/lib/auto-match";
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

interface RowProps {
  layer: TalkingHeadLayer;
  timeline: MatchedSection[] | null;
  pxPerSecond: number;
  selectedSectionIndex: number | null;
  onSelectSection: (i: number) => void;
  onRemoveLayer: (id: string) => void;
}

function LayerRow({
  layer,
  timeline,
  pxPerSecond,
  selectedSectionIndex,
  onSelectSection,
  onRemoveLayer,
}: RowProps) {
  // Layer tag is stored lowercase by the store helpers; section tags arrive in original
  // case from the parser so we normalize on compare. Anything that matches gets rendered
  // as a sparse block at the section's absolute time.
  const matches = (timeline ?? []).filter((s) => s.tag.toLowerCase() === layer.tag);
  return (
    <div className="relative h-10 flex items-stretch border-b border-border/50 group">
      <div className="absolute left-0 top-0 bottom-0 w-32 z-10 flex items-center gap-1 px-2 bg-background/95 backdrop-blur-sm border-r border-border text-[10px]">
        <span className="font-mono text-purple-300 truncate flex-1">{layer.tag}</span>
        {matches.length === 0 && (
          <span title="No section matches this tag yet">
            <AlertTriangle className="w-3 h-3 text-yellow-400" />
          </span>
        )}
        <button
          onClick={() => onRemoveLayer(layer.id)}
          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
          aria-label={`Delete layer ${layer.tag}`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="absolute left-32 top-0 bottom-0 right-0">
        {matches.map((s) => {
          const left = (s.startMs / 1000) * pxPerSecond;
          const width = (s.durationMs / 1000) * pxPerSecond;
          const isSelected = timeline?.[selectedSectionIndex ?? -1] === s;
          return (
            <button
              key={s.sectionIndex}
              type="button"
              onClick={() => onSelectSection(s.sectionIndex)}
              className={
                "absolute top-1 bottom-1 px-1.5 rounded-sm text-[10px] flex items-center truncate transition " +
                (isSelected
                  ? "bg-purple-500/40 border border-purple-300 text-white"
                  : "bg-purple-500/20 border border-purple-500/60 text-purple-100 hover:bg-purple-500/30")
              }
              style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
              title={`${layer.tag} · ${s.durationMs}ms`}
            >
              <span className="truncate">{s.tag}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TrackTalkingHead({ pxPerSecond }: { pxPerSecond: number }) {
  const {
    talkingHeadLayers,
    timeline,
    selectedSectionIndex,
    setSelectedSectionIndex,
    removeTalkingHeadLayer,
  } = useBuildState();
  if (talkingHeadLayers.length === 0) return null;
  return (
    <div>
      {talkingHeadLayers.map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          timeline={timeline}
          pxPerSecond={pxPerSecond}
          selectedSectionIndex={selectedSectionIndex}
          onSelectSection={setSelectedSectionIndex}
          onRemoveLayer={(id) => {
            void removeTalkingHeadLayer(id);
          }}
        />
      ))}
    </div>
  );
}
