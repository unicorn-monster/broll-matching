"use client";

import { useMemo, useRef, useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import {
  listTracks,
  maxTrackIndex,
  pickTrack,
  type CreateZone,
  type TrackBand,
} from "@/lib/overlay/overlay-tracks";
import { computeSnap, type SnapCandidate } from "@/lib/overlay/overlay-snap";
import { isOverlapOnSameTrack } from "@/lib/overlay/overlay-collision";
import {
  addOverlay,
  addOverlayWithNewTrack,
  compactTracks,
} from "@/lib/overlay/overlay-store";
import type { BrollVideoOverlay, OverlayItem } from "@/lib/overlay/overlay-types";
import { OverlayClipBlock } from "./overlay-clip-block";
import { useOverlayDrag } from "./overlay-drag-context";
import { useOverlayKeyboard } from "./use-overlay-keyboard";

const TRACK_HEIGHT = 40;
const GAP_HEIGHT = 6;
const EMPTY_ZONE_HEIGHT = TRACK_HEIGHT;
const SNAP_THRESHOLD_PX = 10;

interface OverlayTracksProps {
  pxPerSecond: number;
}

interface GhostState {
  startMs: number;
  durationMs: number;
  trackIndex: number;
  mode: "create" | "into";
  top: number;
  height: number;
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
    setAudioSelected,
  } = useBuildState();
  const { dragInfo, startDrag, endDrag } = useOverlayDrag();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);

  const tracks = useMemo(() => listTracks(overlays), [overlays]);
  const isDragging = dragInfo !== null;
  const tracksTopDown = [...tracks].reverse();
  const hasTracks = tracksTopDown.length > 0;

  const totalHeight = hasTracks
    ? tracksTopDown.length * TRACK_HEIGHT + (tracksTopDown.length + 1) * GAP_HEIGHT
    : EMPTY_ZONE_HEIGHT;

  const snapCandidates = useMemo<SnapCandidate[]>(() => {
    const out: SnapCandidate[] = [
      { ms: 0, kind: "zero" },
      { ms: playheadMs, kind: "playhead" },
    ];
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

  function bandTop(rowIdx: number): number {
    return GAP_HEIGHT + rowIdx * (TRACK_HEIGHT + GAP_HEIGHT);
  }

  function buildBandsAndZones(): { bands: TrackBand[]; zones: CreateZone[] } {
    if (!hasTracks) {
      return {
        bands: [],
        zones: [{ top: 0, bottom: EMPTY_ZONE_HEIGHT, newTrackIndex: 0 }],
      };
    }
    const bands: TrackBand[] = tracksTopDown.map((trackIdx, rowIdx) => ({
      trackIndex: trackIdx,
      top: bandTop(rowIdx),
      bottom: bandTop(rowIdx) + TRACK_HEIGHT,
    }));
    const maxIdx = maxTrackIndex(overlays);
    const zones: CreateZone[] = [];
    zones.push({ top: 0, bottom: GAP_HEIGHT, newTrackIndex: maxIdx + 1 });
    for (let i = 0; i < tracksTopDown.length - 1; i++) {
      const band = bands[i];
      const trackIdx = tracksTopDown[i];
      if (!band || trackIdx === undefined) continue;
      const gapTop = band.bottom;
      zones.push({
        top: gapTop,
        bottom: gapTop + GAP_HEIGHT,
        newTrackIndex: trackIdx,
      });
    }
    const last = bands[bands.length - 1];
    if (last) {
      zones.push({
        top: last.bottom,
        bottom: last.bottom + GAP_HEIGHT,
        newTrackIndex: 0,
      });
    }
    return { bands, zones };
  }

  function localCoords(e: React.DragEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function ghostTopFor(mode: "create" | "into", trackIdx: number, bands: TrackBand[]): number {
    if (mode === "into") {
      const band = bands.find((b) => b.trackIndex === trackIdx);
      return band ? band.top : 0;
    }
    if (!hasTracks) return 0;
    const maxIdx = maxTrackIndex(overlays);
    if (trackIdx > maxIdx) return 0;
    if (trackIdx === 0) {
      const lastBand = bands[bands.length - 1];
      return lastBand ? lastBand.bottom + GAP_HEIGHT - TRACK_HEIGHT : 0;
    }
    const upperRowIdx = tracksTopDown.indexOf(trackIdx);
    if (upperRowIdx === -1) return 0;
    const upperBand = bands[upperRowIdx];
    return upperBand ? upperBand.bottom : 0;
  }

  function onDragOver(e: React.DragEvent) {
    if (!dragInfo) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragInfo.mode === "move" ? "move" : "copy";

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

    const { snappedStartMs } = computeSnap(
      rawStartMs,
      filteredCandidates,
      pxPerSecond,
      SNAP_THRESHOLD_PX,
    );

    const { bands, zones } = buildBandsAndZones();
    const pick = pickTrack(y, bands, zones, maxTrackIndex(overlays));

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

    const top = hasTracks ? ghostTopFor(pick.mode, pick.trackIndex, bands) : 0;
    const height = TRACK_HEIGHT;

    setGhost({
      startMs: snappedStartMs,
      durationMs,
      trackIndex: pick.trackIndex,
      mode: pick.mode,
      top,
      height,
      valid,
    });
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
        ghost.mode === "create"
          ? addOverlayWithNewTrack(prev, newOverlay)
          : addOverlay(prev, newOverlay),
      );
      setSelectedOverlayId(newOverlay.id);
    }

    if (dragInfo.mode === "move") {
      setOverlays((prev) => {
        const moving = prev.find((o) => o.id === dragInfo.existingOverlayId);
        if (!moving) return prev;
        const without = prev.filter((o) => o.id !== dragInfo.existingOverlayId);
        const updated: OverlayItem = {
          ...moving,
          startMs: ghost.startMs,
          trackIndex: ghost.trackIndex,
        };
        const next =
          ghost.mode === "create"
            ? addOverlayWithNewTrack(without, updated)
            : [...without, updated];
        return compactTracks(next);
      });
    }

    setGhost(null);
  }

  if (tracks.length === 0 && !isDragging) return null;

  let ghostVisual: React.ReactNode = null;
  if (ghost) {
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
          top: `${ghost.top}px`,
          width: `${ghostWidth}px`,
          height: `${ghost.height}px`,
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
        setAudioSelected(false);
        const rect = containerRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ms = Math.max(0, (x / pxPerSecond) * 1000);
        playerSeekRef.current?.(ms);
      }}
      className="relative bg-muted/5 border-b border-border/40"
      style={{ height: `${totalHeight}px` }}
    >
      {tracksTopDown.map((trackIdx, rowIdx) => {
        const top = bandTop(rowIdx);
        const trackOverlays = overlays.filter((o) => o.trackIndex === trackIdx);
        return (
          <div
            key={trackIdx}
            data-overlay-track
            data-track-index={trackIdx}
            className="absolute left-0 right-0 bg-muted/10"
            style={{ top: `${top}px`, height: `${TRACK_HEIGHT}px` }}
          >
            {trackOverlays.map((o) => (
              <OverlayClipBlock
                key={o.id}
                overlay={o}
                pxPerSecond={pxPerSecond}
                selected={selectedOverlayId === o.id}
                onSelect={() => {
                  setSelectedOverlayId(o.id);
                  setAudioSelected(false);
                }}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "move";
                  const img = new Image();
                  img.src =
                    "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
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
