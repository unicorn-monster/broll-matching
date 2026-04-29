"use client";

import { useCallback } from "react";
import { useOverlayDrag } from "./overlay-drag-context";

export interface OverlayDragSourceClip {
  clipId: string;
  indexeddbKey: string;
  durationMs: number;
  thumbnailUrl: string | null;
}

const EMPTY_GHOST = (() => {
  if (typeof window === "undefined") return null;
  const img = new Image();
  img.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  return img;
})();

export function useOverlayDragSource(clip: OverlayDragSourceClip) {
  const { startDrag, endDrag } = useOverlayDrag();

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "copy";
      if (EMPTY_GHOST) e.dataTransfer.setDragImage(EMPTY_GHOST, 0, 0);
      startDrag({
        mode: "create",
        kind: "broll-video",
        clipId: clip.clipId,
        indexeddbKey: clip.indexeddbKey,
        sourceDurationMs: clip.durationMs,
        thumbnailUrl: clip.thumbnailUrl,
      });
    },
    [clip, startDrag],
  );

  const onDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  return { draggable: true, onDragStart, onDragEnd } as const;
}
