"use client";

import { useEffect, useRef, useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import { drawTextOverlay, computeOverlayPixelBox } from "@/lib/text-overlay/text-overlay-render";
import { mutateOverlay } from "@/lib/overlay/overlay-store";
import { applyStyleToAll } from "@/lib/text-overlay/text-overlay-store";
import { TEXT_OVERLAY_SNAP_AXES, TEXT_OVERLAY_SNAP_THRESHOLD_PX } from "@/lib/text-overlay/text-style-defaults";

interface Props {
  frameWidthPx: number;
  frameHeightPx: number;
}

export function TextOverlayLayer({ frameWidthPx, frameHeightPx }: Props) {
  const {
    overlays,
    playheadMs,
    selectedOverlayId,
    setSelectedOverlayId,
    setOverlays,
    textOverlayApplyAll,
  } = useBuildState();
  const visibleTexts = overlays.filter(
    (o): o is TextOverlay =>
      o.kind === "text" && playheadMs >= o.startMs && playheadMs < o.startMs + o.durationMs,
  );

  return (
    <>
      {visibleTexts.map((t) => (
        <TextItem
          key={t.id}
          overlay={t}
          frameWidthPx={frameWidthPx}
          frameHeightPx={frameHeightPx}
          selected={selectedOverlayId === t.id}
          onSelect={() => setSelectedOverlayId(t.id)}
          onCommitPosition={(positionXFrac, positionYFrac) => {
            if (textOverlayApplyAll) {
              setOverlays((prev) => applyStyleToAll(prev, { positionXFrac, positionYFrac }));
            } else {
              setOverlays((prev) => mutateOverlay(prev, t.id, { positionXFrac, positionYFrac }));
            }
          }}
        />
      ))}
    </>
  );
}

interface ItemProps {
  overlay: TextOverlay;
  frameWidthPx: number;
  frameHeightPx: number;
  selected: boolean;
  onSelect: () => void;
  onCommitPosition: (xFrac: number, yFrac: number) => void;
}

function TextItem({ overlay, frameWidthPx, frameHeightPx, selected, onSelect, onCommitPosition }: ItemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [boxPx, setBoxPx] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dragStart, setDragStart] = useState<{ pointerX: number; pointerY: number; xFrac: number; yFrac: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio ?? 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const measureBox = computeOverlayPixelBox(ctx, overlay.text || "Edit text…", overlay, frameWidthPx, frameHeightPx);
    canvas.width = Math.max(1, measureBox.width) * dpr;
    canvas.height = Math.max(1, measureBox.height) * dpr;
    canvas.style.width = `${measureBox.width}px`;
    canvas.style.height = `${measureBox.height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTextOverlay(ctx, overlay.text || "Edit text…", overlay, frameWidthPx, frameHeightPx);
    setBoxPx({ x: measureBox.x, y: measureBox.y, w: measureBox.width, h: measureBox.height });
  }, [overlay, frameWidthPx, frameHeightPx]);

  useEffect(() => {
    if (!dragStart) return;
    function onMove(e: PointerEvent) {
      if (!dragStart) return;
      const dxFrac = (e.clientX - dragStart.pointerX) / frameWidthPx;
      const dyFrac = (e.clientY - dragStart.pointerY) / frameHeightPx;
      let newX = dragStart.xFrac + dxFrac;
      let newY = dragStart.yFrac + dyFrac;
      const snapThresholdXFrac = TEXT_OVERLAY_SNAP_THRESHOLD_PX / frameWidthPx;
      const snapThresholdYFrac = TEXT_OVERLAY_SNAP_THRESHOLD_PX / frameHeightPx;
      for (const axis of TEXT_OVERLAY_SNAP_AXES) {
        if (Math.abs(newX - axis) < snapThresholdXFrac) newX = axis;
        if (Math.abs(newY - axis) < snapThresholdYFrac) newY = axis;
      }
      onCommitPosition(Math.max(0.02, Math.min(0.98, newX)), Math.max(0.02, Math.min(0.98, newY)));
    }
    function onUp() { setDragStart(null); }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [dragStart, frameWidthPx, frameHeightPx, onCommitPosition]);

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    onSelect();
    if (!selected) return;
    setDragStart({
      pointerX: e.clientX, pointerY: e.clientY,
      xFrac: overlay.positionXFrac, yFrac: overlay.positionYFrac,
    });
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={selected ? "absolute outline outline-2 outline-orange-400 outline-offset-2 cursor-move" : "absolute cursor-pointer"}
      style={{
        left: `${boxPx.x}px`, top: `${boxPx.y}px`,
        width: `${boxPx.w}px`, height: `${boxPx.h}px`,
      }}
    >
      <canvas ref={canvasRef} className="block pointer-events-none" />
    </div>
  );
}
