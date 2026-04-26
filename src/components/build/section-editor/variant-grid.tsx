"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
import { formatMs } from "@/lib/format-time";
import type { ClipMetadata } from "@/lib/auto-match";

interface VariantGridProps {
  variants: ClipMetadata[];
  selectedClipId: string | null;
  onSelect: (clip: ClipMetadata) => void;
  inChainIds: Set<string>;
}

export function VariantGrid({ variants, selectedClipId, onSelect, inChainIds }: VariantGridProps) {
  if (variants.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-8 text-center">
        No b-rolls found for this tag. Upload some first.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 overflow-y-auto p-1">
      {variants.map((clip) => (
        <VariantTile
          key={clip.id}
          clip={clip}
          selected={clip.id === selectedClipId}
          inChain={inChainIds.has(clip.id)}
          onClick={() => onSelect(clip)}
        />
      ))}
    </div>
  );
}

function VariantTile({
  clip,
  selected,
  inChain,
  onClick,
}: {
  clip: ClipMetadata;
  selected: boolean;
  inChain: boolean;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    getThumbnail(clip.indexeddbKey).then((buf) => {
      if (!active || !buf) return;
      objectUrl = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      setSrc(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clip.id]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-stretch text-left rounded-md border overflow-hidden transition",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground",
      )}
    >
      <div className="aspect-[4/5] bg-muted">
        {src && <img src={src} alt={clip.brollName} className="w-full h-full object-cover" />}
      </div>
      <div className="px-2 py-1 text-xs">
        <div className="truncate font-medium">{clip.brollName}</div>
        <div className="text-muted-foreground">{formatMs(clip.durationMs)}</div>
      </div>
      {inChain && (
        <div className="absolute top-1 right-1 text-[10px] bg-primary text-primary-foreground rounded px-1 py-0.5">
          ✓ in chain
        </div>
      )}
    </button>
  );
}
