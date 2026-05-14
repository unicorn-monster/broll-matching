"use client";

import { useEffect, useRef, useState } from "react";
import { Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuildState } from "@/components/build/build-state-context";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import { snapToNeighbor } from "@/lib/text-overlay/text-overlay-store";
import { snapMsToFrame } from "@/lib/frame-align";

interface Props {
  pxPerSecond: number;
}

const ROW_HEIGHT = 28;
const RESIZE_HANDLE_PX = 6;
const MIN_DURATION_MS = 200;

type DragMode =
  | { kind: "move"; id: string; initialStartMs: number; pointerStartX: number }
  | { kind: "resize-left"; id: string; initialStartMs: number; initialDurationMs: number; pointerStartX: number }
  | { kind: "resize-right"; id: string; initialDurationMs: number; pointerStartX: number };

export function TrackTextOverlays({ pxPerSecond }: Props) {
  const { overlays, setOverlays, selectedOverlayId, setSelectedOverlayId } = useBuildState();
  const [drag, setDrag] = useState<DragMode | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const texts = overlays.filter((o): o is TextOverlay => o.kind === "text");

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dxMs = ((e.clientX - d.pointerStartX) / pxPerSecond) * 1000;
      setOverlays((prev) => {
        return prev.map((o) => {
          if (o.id !== d.id || o.kind !== "text") return o;
          const others = prev.filter((x): x is TextOverlay => x.kind === "text" && x.id !== d.id);
          if (d.kind === "move") {
            const proposed = { startMs: Math.max(0, snapMsToFrame(d.initialStartMs + dxMs)), durationMs: o.durationMs };
            const snapped = snapToNeighbor(proposed, d.id, others);
            return { ...o, startMs: snapped.startMs };
          } else if (d.kind === "resize-left") {
            const newStart = Math.max(0, snapMsToFrame(d.initialStartMs + dxMs));
            const maxStart = d.initialStartMs + d.initialDurationMs - MIN_DURATION_MS;
            const clampedStart = Math.min(newStart, maxStart);
            const newDuration = d.initialStartMs + d.initialDurationMs - clampedStart;
            const proposed = { startMs: clampedStart, durationMs: newDuration };
            const snapped = snapToNeighbor(proposed, d.id, others);
            return { ...o, startMs: snapped.startMs, durationMs: snapped.durationMs };
          } else {
            const proposedDuration = Math.max(MIN_DURATION_MS, snapMsToFrame(d.initialDurationMs + dxMs));
            const proposed = { startMs: o.startMs, durationMs: proposedDuration };
            const snapped = snapToNeighbor(proposed, d.id, others);
            return { ...o, startMs: snapped.startMs, durationMs: snapped.durationMs };
          }
        });
      });
    }
    function onUp() { setDrag(null); }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [drag, pxPerSecond, setOverlays]);

  function startDrag(e: React.PointerEvent, t: TextOverlay) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const localX = e.clientX - rect.left;
    e.preventDefault();
    e.stopPropagation();
    setSelectedOverlayId(t.id);
    if (localX < RESIZE_HANDLE_PX) {
      setDrag({ kind: "resize-left", id: t.id, initialStartMs: t.startMs, initialDurationMs: t.durationMs, pointerStartX: e.clientX });
    } else if (localX > rect.width - RESIZE_HANDLE_PX) {
      setDrag({ kind: "resize-right", id: t.id, initialDurationMs: t.durationMs, pointerStartX: e.clientX });
    } else {
      setDrag({ kind: "move", id: t.id, initialStartMs: t.startMs, pointerStartX: e.clientX });
    }
  }

  return (
    <div className="relative" style={{ height: `${ROW_HEIGHT}px` }}>
      {texts.map((t) => {
        const left = (t.startMs / 1000) * pxPerSecond;
        const width = Math.max(8, (t.durationMs / 1000) * pxPerSecond);
        const isSelected = selectedOverlayId === t.id;
        return (
          <div
            key={t.id}
            data-overlay-block
            data-kind="text"
            onPointerDown={(e) => startDrag(e, t)}
            className={cn(
              "absolute top-1 bottom-1 rounded-md border text-[10px] font-medium flex items-center gap-1 px-1.5 select-none overflow-hidden cursor-grab",
              "bg-orange-500/15 border-orange-500/40 text-orange-200",
              isSelected && "ring-2 ring-orange-400 ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${width}px` }}
            title={t.text}
          >
            <Type className="w-3 h-3 shrink-0" />
            <span className="truncate">{t.text || "Edit text…"}</span>
          </div>
        );
      })}
    </div>
  );
}
