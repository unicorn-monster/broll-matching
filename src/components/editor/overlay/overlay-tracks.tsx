"use client";

import { useMemo, useRef, useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { listTracks, maxTrackIndex, pickTrack } from "@/lib/overlay/overlay-tracks";
import { computeSnap, type SnapCandidate } from "@/lib/overlay/overlay-snap";
import { isOverlapOnSameTrack } from "@/lib/overlay/overlay-collision";
import { addOverlay, addOverlayWithNewTrack, moveOverlay, compactTracks } from "@/lib/overlay/overlay-store";
import type { BrollVideoOverlay } from "@/lib/overlay/overlay-types";
import { OverlayClipBlock } from "./overlay-clip-block";
import { OverlayDropZone } from "./overlay-drop-zone";
import { useOverlayDrag } from "./overlay-drag-context";
import { useOverlayKeyboard } from "./use-overlay-keyboard";

const TRACK_HEIGHT = 40;
const TOP_ZONE_HEIGHT = 24;
const SNAP_THRESHOLD_PX = 10;

interface OverlayTracksProps {
  pxPerSecond: number;
}

interface GhostState {
  startMs: number;
  durationMs: number;
  trackIndex: number;
  mode: "create" | "into";
  valid: boolean;
}

export function OverlayTracks({ pxPerSecond }: OverlayTracksProps) {
  useOverlayKeyboard();

  const {
    overlays,
    setOverlays,
    selectedOverlayId,
    setSelectedOverlayId,
    timeline,
    playheadMs,
    playerSeekRef,
  } = useBuildState();
  const { dragInfo, startDrag, endDrag } = useOverlayDrag();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);

  const tracks = useMemo(() => listTracks(overlays), [overlays]);
  const isDragging = dragInfo !== null;
  const tracksTopDown = [...tracks].reverse();
  const totalHeight = TOP_ZONE_HEIGHT + tracksTopDown.length * TRACK_HEIGHT;

  const snapCandidates = useMemo<SnapCandidate[]>(() => {
    const out: SnapCandidate[] = [{ ms: 0, kind: "zero" }, { ms: playheadMs, kind: "playhead" }];
    if (timeline) {
      let cursor = 0;
      for (const s of timeline) {
        out.push({ ms: cursor, kind: "section" });
        cursor += s.durationMs;
      }
      out.push({ ms: cursor, kind: "section" });
    }
    for (const o of overlays) {
      out.push({ ms: o.startMs, kind: "edge" });
      out.push({ ms: o.startMs + o.durationMs, kind: "edge" });
    }
    return out;
  }, [overlays, playheadMs, timeline]);

  function localCoords(e: React.DragEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDragOver(e: React.DragEvent) {
    if (!dragInfo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";

    const { x, y } = localCoords(e);
    const rawStartMs = Math.max(0, (x / pxPerSecond) * 1000);

    const filteredCandidates =
      dragInfo.mode === "move"
        ? snapCandidates.filter((c) => {
            const moving = overlays.find((o) => o.id === dragInfo.existingOverlayId);
            if (!moving || c.kind !== "edge") return true;
            return c.ms !== moving.startMs && c.ms !== moving.startMs + moving.durationMs;
          })
        : snapCandidates;

    const { snappedStartMs } = computeSnap(rawStartMs, filteredCandidates, pxPerSecond, SNAP_THRESHOLD_PX);

    const trackBands = tracksTopDown.map((trackIdx, rowIdx) => ({
      trackIndex: trackIdx,
      top: TOP_ZONE_HEIGHT + rowIdx * TRACK_HEIGHT,
      bottom: TOP_ZONE_HEIGHT + (rowIdx + 1) * TRACK_HEIGHT,
    }));
    const pick = pickTrack(
      y,
      trackBands,
      { topZoneTop: 0, topZoneBottom: TOP_ZONE_HEIGHT },
      maxTrackIndex(overlays),
    );

    let durationMs = 0;
    let idToIgnore: string | undefined;
    if (dragInfo.mode === "create") {
      durationMs = dragInfo.sourceDurationMs;
    } else {
      const moving = overlays.find((o) => o.id === dragInfo.existingOverlayId);
      if (!moving) return;
      durationMs = moving.durationMs;
      idToIgnore = moving.id;
    }

    const collisionTarget = idToIgnore
      ? { trackIndex: pick.trackIndex, startMs: snappedStartMs, durationMs, idToIgnore }
      : { trackIndex: pick.trackIndex, startMs: snappedStartMs, durationMs };
    const valid = pick.mode === "create" || !isOverlapOnSameTrack(overlays, collisionTarget);

    setGhost({ startMs: snappedStartMs, durationMs, trackIndex: pick.trackIndex, mode: pick.mode, valid });
  }

  function onDragLeave() {
    setGhost(null);
  }

  function onDrop(e: React.DragEvent) {
    if (!dragInfo || !ghost) return;
    e.preventDefault();

    if (!ghost.valid) {
      setGhost(null);
      return;
    }

    if (dragInfo.mode === "create") {
      const newOverlay: BrollVideoOverlay = {
        id: crypto.randomUUID(),
        kind: "broll-video",
        trackIndex: ghost.trackIndex,
        startMs: ghost.startMs,
        durationMs: dragInfo.sourceDurationMs,
        sourceStartMs: 0,
        sourceDurationMs: dragInfo.sourceDurationMs,
        clipId: dragInfo.clipId,
        indexeddbKey: dragInfo.indexeddbKey,
        volume: 1,
        muted: false,
        fadeInMs: 0,
        fadeOutMs: 0,
      };
      setOverlays((prev) =>
        ghost.mode === "create" ? addOverlayWithNewTrack(prev, newOverlay) : addOverlay(prev, newOverlay),
      );
      setSelectedOverlayId(newOverlay.id);
    }

    if (dragInfo.mode === "move") {
      setOverlays((prev) =>
        compactTracks(
          moveOverlay(prev, dragInfo.existingOverlayId, {
            startMs: ghost.startMs,
            trackIndex: ghost.trackIndex,
          }),
        ),
      );
    }

    setGhost(null);
  }

  if (tracks.length === 0 && !isDragging) return null;

  let ghostVisual: React.ReactNode = null;
  if (ghost) {
    let ghostTop: number;
    if (ghost.mode === "create") {
      ghostTop = 0;
    } else {
      const rowIdx = tracksTopDown.indexOf(ghost.trackIndex);
      ghostTop = TOP_ZONE_HEIGHT + rowIdx * TRACK_HEIGHT;
    }
    const ghostLeft = (ghost.startMs / 1000) * pxPerSecond;
    const ghostWidth = Math.max(2, (ghost.durationMs / 1000) * pxPerSecond);
    const borderClr = ghost.valid
      ? ghost.mode === "create"
        ? "border-orange-400"
        : "border-cyan-400"
      : "border-red-500";
    ghostVisual = (
      <div
        className={`absolute pointer-events-none rounded border-2 ${borderClr} bg-white/10`}
        style={{
          left: `${ghostLeft}px`,
          top: `${ghostTop + 2}px`,
          width: `${ghostWidth}px`,
          height: `${ghost.mode === "create" ? TOP_ZONE_HEIGHT : TRACK_HEIGHT}px`,
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      data-overlay-tracks
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("[data-overlay-block]")) return;
        setSelectedOverlayId(null);
        const rect = containerRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ms = Math.max(0, (x / pxPerSecond) * 1000);
        playerSeekRef.current?.(ms);
      }}
      className="relative bg-muted/5 border-b border-border/40"
      style={{ height: `${totalHeight}px` }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: TOP_ZONE_HEIGHT }}>
        <OverlayDropZone active={isDragging} variant="top" />
      </div>

      {tracksTopDown.map((trackIdx, rowIdx) => {
        const top = TOP_ZONE_HEIGHT + rowIdx * TRACK_HEIGHT;
        const trackOverlays = overlays.filter((o) => o.trackIndex === trackIdx);
        return (
          <div
            key={trackIdx}
            data-overlay-track
            data-track-index={trackIdx}
            className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: `${top}px`, height: `${TRACK_HEIGHT}px` }}
          >
            {trackOverlays.map((o) => (
              <OverlayClipBlock
                key={o.id}
                overlay={o}
                pxPerSecond={pxPerSecond}
                selected={selectedOverlayId === o.id}
                onSelect={() => setSelectedOverlayId(o.id)}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "move";
                  const img = new Image();
                  img.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
                  ev.dataTransfer.setDragImage(img, 0, 0);
                  startDrag({ mode: "move", existingOverlayId: o.id });
                }}
                onDragEnd={() => endDrag()}
              />
            ))}
          </div>
        );
      })}

      {ghostVisual}
    </div>
  );
}
