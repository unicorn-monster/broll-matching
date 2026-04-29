"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface CreateDragInfo {
  mode: "create";
  kind: "broll-video";
  clipId: string;
  indexeddbKey: string;
  sourceDurationMs: number;
  thumbnailUrl: string | null;
}

export interface MoveDragInfo {
  mode: "move";
  existingOverlayId: string;
}

export type DragInfo = CreateDragInfo | MoveDragInfo;

interface OverlayDragState {
  dragInfo: DragInfo | null;
  startDrag: (info: DragInfo) => void;
  endDrag: () => void;
}

const OverlayDragContext = createContext<OverlayDragState | null>(null);

export function OverlayDragProvider({ children }: { children: React.ReactNode }) {
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);

  const startDrag = useCallback((info: DragInfo) => setDragInfo(info), []);
  const endDrag = useCallback(() => setDragInfo(null), []);

  const value = useMemo<OverlayDragState>(
    () => ({ dragInfo, startDrag, endDrag }),
    [dragInfo, startDrag, endDrag],
  );

  return <OverlayDragContext.Provider value={value}>{children}</OverlayDragContext.Provider>;
}

export function useOverlayDrag() {
  const ctx = useContext(OverlayDragContext);
  if (!ctx) throw new Error("useOverlayDrag must be used within OverlayDragProvider");
  return ctx;
}
