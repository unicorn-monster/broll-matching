"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
import type { OverlayItem } from "@/lib/overlay/overlay-types";

interface OverlayClipBlockProps {
  overlay: OverlayItem;
  pxPerSecond: number;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export function OverlayClipBlock({
  overlay,
  pxPerSecond,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: OverlayClipBlockProps) {
  const left = (overlay.startMs / 1000) * pxPerSecond;
  const width = Math.max(2, (overlay.durationMs / 1000) * pxPerSecond);

  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    if (overlay.kind === "broll-video") {
      getThumbnail(overlay.indexeddbKey).then((buf) => {
        if (!active || !buf) return;
        url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        setThumbUrl(url);
      });
    }
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [overlay]);

  return (
    <div
      data-overlay-block
      data-overlay-id={overlay.id}
      draggable
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "absolute top-0.5 bottom-0.5 rounded overflow-hidden border cursor-grab active:cursor-grabbing",
        "bg-purple-900/40 border-purple-500/60",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
      style={{ left: `${left}px`, width: `${width}px` }}
      title={`${overlay.startMs}ms — ${overlay.startMs + overlay.durationMs}ms`}
    >
      {thumbUrl && (
        <img src={thumbUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
      )}
      <div className="relative px-1 py-0.5 text-[9px] text-white/90 truncate bg-black/30">
        {overlay.kind === "broll-video" ? overlay.clipId.slice(0, 8) : overlay.kind}
      </div>
    </div>
  );
}
