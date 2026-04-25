"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
import { formatMs } from "@/lib/format-time";
import type { ClipMetadata } from "@/lib/auto-match";

/**
 * `activeSlot` semantics:
 *   - integer in [0, picks.length): user is editing that slot
 *   - picks.length: user is adding a new slot (the "+" tile)
 *   - null: no slot active
 */
interface ChainStripProps {
  picks: ClipMetadata[];
  activeSlot: number | null;
  onActivateSlot: (slot: number) => void;
  onActivateAdd: () => void;
  onRemoveSlot: (slot: number) => void;
}

export function ChainStrip({ picks, activeSlot, onActivateSlot, onActivateAdd, onRemoveSlot }: ChainStripProps) {
  return (
    <div className="flex gap-2 overflow-x-auto p-1 border-b border-border">
      {picks.map((clip, i) => (
        <SlotTile
          key={`${i}-${clip.id}`}
          clip={clip}
          slotIndex={i}
          active={activeSlot === i}
          onClick={() => onActivateSlot(i)}
          onRemove={() => onRemoveSlot(i)}
        />
      ))}
      <button
        type="button"
        onClick={onActivateAdd}
        className={cn(
          "shrink-0 w-20 h-28 rounded-md border-2 border-dashed flex items-center justify-center transition",
          activeSlot === picks.length
            ? "border-primary text-primary"
            : "border-border text-muted-foreground hover:border-muted-foreground",
        )}
        aria-label="Add clip to chain"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}

function SlotTile({
  clip,
  slotIndex,
  active,
  onClick,
  onRemove,
}: {
  clip: ClipMetadata;
  slotIndex: number;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    getThumbnail(clip.id).then((buf) => {
      if (buf) {
        objectUrl = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        setSrc(objectUrl);
      }
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clip.id]);

  return (
    <div
      className={cn(
        "relative shrink-0 w-20 h-28 rounded-md border overflow-hidden cursor-pointer transition",
        active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground",
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <div className="absolute top-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 z-10">
        slot {slotIndex + 1}
      </div>
      <div className="w-full h-full bg-muted">
        {src && <img src={src} alt={clip.brollName} className="w-full h-full object-cover" />}
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
        {formatMs(clip.durationMs)}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-1 right-1 z-20 bg-black/60 hover:bg-red-500 text-white rounded p-0.5"
        aria-label={`Remove slot ${slotIndex + 1}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
