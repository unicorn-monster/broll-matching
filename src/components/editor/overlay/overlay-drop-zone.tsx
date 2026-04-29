"use client";

import { cn } from "@/lib/utils";

interface OverlayDropZoneProps {
  active: boolean;
  variant: "top" | "track-empty";
}

export function OverlayDropZone({ active, variant }: OverlayDropZoneProps) {
  if (!active) return null;
  return (
    <div
      className={cn(
        "absolute left-0 right-0 flex items-center justify-center pointer-events-none",
        "border-2 border-dashed border-cyan-400/60 bg-cyan-400/5 text-[10px] text-cyan-300",
        variant === "top" ? "h-6" : "h-10",
      )}
    >
      {variant === "top" ? "+ New track" : "Drop overlay here"}
    </div>
  );
}
