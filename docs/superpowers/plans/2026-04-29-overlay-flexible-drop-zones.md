# Overlay Flexible Drop Zones (CapCut-Style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép drop b-roll vào bất kỳ vị trí nào trong vùng overlay (top, bottom, vào track có sẵn, hoặc gap giữa 2 tracks) — và đảo layout để overlay nằm trên main clips theo CapCut style.

**Architecture:** Refactor pickTrack lib để nhận multiple "create zones" thay vì 1 top zone. OverlayTracks component compute zones từ vị trí các band + gap (6px) giữa các band. Move overlay handling cho mode "create" dùng addOverlayWithNewTrack-style shift. Reorder TimelinePanel để OverlayTracks render trước TrackClips.

**Tech Stack:** React 19 + TypeScript, Vitest, TailwindCSS. Drag/drop dùng HTML5 native API qua existing OverlayDragContext.

**Spec:** [docs/superpowers/specs/2026-04-29-overlay-flexible-drop-zones-design.md](../specs/2026-04-29-overlay-flexible-drop-zones-design.md)

---

## File Structure

**Modify:**
- `src/lib/overlay/overlay-tracks.ts` — refactor pickTrack signature: `topZone: TopZone` → `createZones: CreateZone[]`
- `src/lib/overlay/__tests__/overlay-tracks.test.ts` — update existing tests + add tests for between-gap, bottom edge, fallback
- `src/components/editor/overlay/overlay-tracks.tsx` — gap rendering between bands, multi-zone pick, ghost top/height computed in onDragOver, MOVE-to-create branch with shift, remove OverlayDropZone usage
- `src/components/editor/timeline/timeline-panel.tsx` — render OverlayTracks before TrackClips

**Delete:**
- `src/components/editor/overlay/overlay-drop-zone.tsx` — không còn dùng (no static drop strip)

**Update (if exists):**
- `src/components/editor/overlay/INDEX.md` — remove reference to overlay-drop-zone.tsx if listed

---

## Task 1: Refactor `pickTrack` lib (RED → GREEN)

**Files:**
- Modify: `src/lib/overlay/overlay-tracks.ts`
- Modify: `src/lib/overlay/__tests__/overlay-tracks.test.ts`

### Step 1.1: Replace existing pickTrack tests with new test suite

- [ ] **Write the failing tests**

Replace the entire `describe("pickTrack", ...)` block in `src/lib/overlay/__tests__/overlay-tracks.test.ts` with:

```typescript
describe("pickTrack", () => {
  it("returns create at top edge when mouseY in first create zone", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      3,
      bands,
      [
        { top: 0, bottom: 6, newTrackIndex: 2 },
        { top: 62, bottom: 68, newTrackIndex: 1 },
        { top: 124, bottom: 130, newTrackIndex: 0 },
      ],
      1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 2 });
  });

  it("returns create at between-gap zone (insert between two tracks)", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      65,
      bands,
      [
        { top: 0, bottom: 6, newTrackIndex: 2 },
        { top: 62, bottom: 68, newTrackIndex: 1 },
        { top: 124, bottom: 130, newTrackIndex: 0 },
      ],
      1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 1 });
  });

  it("returns create at bottom edge zone (new track sat main)", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      127,
      bands,
      [
        { top: 0, bottom: 6, newTrackIndex: 2 },
        { top: 62, bottom: 68, newTrackIndex: 1 },
        { top: 124, bottom: 130, newTrackIndex: 0 },
      ],
      1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 0 });
  });

  it("returns into-existing when mouseY in track band", () => {
    const bands = [
      { trackIndex: 1, top: 6, bottom: 62 },
      { trackIndex: 0, top: 68, bottom: 124 },
    ];
    const out = pickTrack(
      30,
      bands,
      [{ top: 0, bottom: 6, newTrackIndex: 2 }],
      1,
    );
    expect(out).toEqual({ mode: "into", trackIndex: 1 });
  });

  it("returns create-track-zero when no tracks exist (empty area)", () => {
    const out = pickTrack(
      28,
      [],
      [{ top: 0, bottom: 56, newTrackIndex: 0 }],
      -1,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 0 });
  });

  it("falls back to create above all when mouseY outside any zone or band", () => {
    const bands = [{ trackIndex: 0, top: 6, bottom: 62 }];
    const out = pickTrack(
      9999,
      bands,
      [{ top: 0, bottom: 6, newTrackIndex: 1 }],
      0,
    );
    expect(out).toEqual({ mode: "create", trackIndex: 1 });
  });
});
```

- [ ] **Run tests to verify they fail**

Run: `pnpm vitest run src/lib/overlay/__tests__/overlay-tracks.test.ts`

Expected: TypeScript compile error (third arg type mismatch) or assertion failures — tests reference `CreateZone` interface and 3-arg-array signature that doesn't exist yet.

### Step 1.2: Refactor pickTrack signature

- [ ] **Replace pickTrack and TopZone in `src/lib/overlay/overlay-tracks.ts`**

Replace the entire file content with:

```typescript
import type { OverlayItem } from "./overlay-types";

export function listTracks(overlays: OverlayItem[]): number[] {
  return Array.from(new Set(overlays.map((o) => o.trackIndex))).sort((a, b) => a - b);
}

export function maxTrackIndex(overlays: OverlayItem[]): number {
  if (overlays.length === 0) return -1;
  return overlays.reduce((m, o) => (o.trackIndex > m ? o.trackIndex : m), -Infinity);
}

export interface TrackBand {
  trackIndex: number;
  top: number;
  bottom: number;
}

export interface CreateZone {
  top: number;
  bottom: number;
  newTrackIndex: number;
}

export type PickResult = { mode: "create" | "into"; trackIndex: number };

export function pickTrack(
  mouseY: number,
  trackBands: TrackBand[],
  createZones: CreateZone[],
  fallbackMaxTrackIndex: number,
): PickResult {
  for (const zone of createZones) {
    if (mouseY >= zone.top && mouseY < zone.bottom) {
      return { mode: "create", trackIndex: zone.newTrackIndex };
    }
  }
  for (const band of trackBands) {
    if (mouseY >= band.top && mouseY < band.bottom) {
      return { mode: "into", trackIndex: band.trackIndex };
    }
  }
  return { mode: "create", trackIndex: Math.max(0, fallbackMaxTrackIndex + 1) };
}
```

- [ ] **Run tests to verify they pass**

Run: `pnpm vitest run src/lib/overlay/__tests__/overlay-tracks.test.ts`

Expected: All 9 tests pass (3 listTracks + 2 maxTrackIndex + 6 new pickTrack).

### Step 1.3: Verify nothing else broke

- [ ] **Run full test suite + typecheck**

Run: `pnpm vitest run && pnpm tsc --noEmit`

Expected: All tests pass. Typecheck shows error in `src/components/editor/overlay/overlay-tracks.tsx` (because component still passes old `topZone` shape). This is expected — fixed in Task 2.

### Step 1.4: Commit

- [ ] **Commit**

```bash
git add src/lib/overlay/overlay-tracks.ts src/lib/overlay/__tests__/overlay-tracks.test.ts
git commit -m "refactor(overlay): pickTrack accepts createZones array for multi-zone drop targeting"
```

---

## Task 2: Update `OverlayTracks` component

**Files:**
- Modify: `src/components/editor/overlay/overlay-tracks.tsx`

This task updates the component to: use new pickTrack API, render gaps between bands, store ghost top/height directly, handle MOVE-to-create with shift, and remove the static OverlayDropZone strip.

### Step 2.1: Replace overlay-tracks.tsx with new implementation

- [ ] **Replace file content**

Replace `src/components/editor/overlay/overlay-tracks.tsx` entirely with:

```tsx
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
    ? GAP_HEIGHT + tracksTopDown.length * TRACK_HEIGHT + (tracksTopDown.length - 1) * GAP_HEIGHT + GAP_HEIGHT
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
      const gapTop = bands[i]!.bottom;
      zones.push({
        top: gapTop,
        bottom: gapTop + GAP_HEIGHT,
        newTrackIndex: tracksTopDown[i]!,
      });
    }
    const last = bands[bands.length - 1]!;
    zones.push({
      top: last.bottom,
      bottom: last.bottom + GAP_HEIGHT,
      newTrackIndex: 0,
    });
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
    if (trackIdx === 0) return bands[bands.length - 1]!.bottom + GAP_HEIGHT - TRACK_HEIGHT;
    const upperRowIdx = tracksTopDown.indexOf(trackIdx);
    if (upperRowIdx === -1) return 0;
    return bands[upperRowIdx]!.bottom;
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
```

Notes for engineer:
- `bandTop(rowIdx)` returns the Y of row `rowIdx` (0 = topmost). Includes top GAP_HEIGHT padding.
- `buildBandsAndZones()` is recomputed each `onDragOver` (cheap; no need to memo).
- `ghostTopFor`:
  - `into`: returns the band's top
  - `create` with `trackIdx > maxIdx`: insertion at top → ghost at Y=0
  - `create` with `trackIdx === 0`: insertion at bottom → ghost at last band bottom + GAP_HEIGHT - TRACK_HEIGHT (so the orange ghost block sits in the bottom edge area; intentionally the ghost block reaches up to where the new track will land after shift)
  - `create` between (trackIdx of an existing track): insertion above the existing track at this index → ghost at the bottom of the row above
- The `OverlayDropZone` import is removed.
- Removed `moveOverlay` import (no longer used).
- `OverlayItem` import added for typing the move branch.

### Step 2.2: Verify typecheck passes

- [ ] **Run typecheck**

Run: `pnpm tsc --noEmit`

Expected: No errors.

### Step 2.3: Verify all tests pass

- [ ] **Run full test suite**

Run: `pnpm vitest run`

Expected: All tests pass.

### Step 2.4: Commit

- [ ] **Commit**

```bash
git add src/components/editor/overlay/overlay-tracks.tsx
git commit -m "feat(overlay): multi-zone drop with between-track gaps and shift on move"
```

---

## Task 3: Reorder TimelinePanel — OverlayTracks above TrackClips

**Files:**
- Modify: `src/components/editor/timeline/timeline-panel.tsx:108-135`

### Step 3.1: Move OverlayTracks render block

- [ ] **Edit timeline-panel.tsx**

In `src/components/editor/timeline/timeline-panel.tsx`, locate the JSX block from `{timeline ? (` through `<OverlayTracks pxPerSecond={effectivePxPerSec} />`. Move the `<OverlayTracks pxPerSecond={effectivePxPerSec} />` line to BEFORE `<TrackClips ...>` so the order becomes:

```tsx
{timeline ? (
  <>
    <TrackTags
      timeline={timeline}
      pxPerSecond={effectivePxPerSec}
      selectedIndex={selectedSectionIndex}
      onSelect={setSelectedSectionIndex}
    />
    <OverlayTracks pxPerSecond={effectivePxPerSec} />
    <TrackClips
      timeline={timeline}
      pxPerSecond={effectivePxPerSec}
      selectedIndex={selectedSectionIndex}
      onSelect={setSelectedSectionIndex}
    />
  </>
) : (
  <div className="h-[130px] flex items-center px-3 text-xs text-muted-foreground">
    Paste script in the toolbar to populate sections.
  </div>
)}
{audioFile ? (
  <TrackAudio audioFile={audioFile} audioDuration={audioDuration} pxPerSecond={effectivePxPerSec} />
) : (
  <div className="h-[56px] flex items-center px-3 text-xs text-muted-foreground bg-muted/10">
    No audio loaded
  </div>
)}
```

The previous standalone `<OverlayTracks pxPerSecond={effectivePxPerSec} />` line below the `{timeline ? ... : ...}` block must be removed. OverlayTracks now renders only when `timeline` is present (which is when overlays make sense anyway).

- [ ] **Verify typecheck + tests**

Run: `pnpm tsc --noEmit && pnpm vitest run`

Expected: All pass.

### Step 3.2: Commit

- [ ] **Commit**

```bash
git add src/components/editor/timeline/timeline-panel.tsx
git commit -m "feat(timeline): render overlay tracks above main clips (CapCut layout)"
```

---

## Task 4: Delete unused `overlay-drop-zone.tsx`

**Files:**
- Delete: `src/components/editor/overlay/overlay-drop-zone.tsx`
- Modify (if exists): `src/components/editor/overlay/INDEX.md`

### Step 4.1: Verify no usages remain

- [ ] **Search for any lingering references**

Run: `grep -rn "OverlayDropZone\|overlay-drop-zone" src/`

Expected: No results.

### Step 4.2: Delete file

- [ ] **Remove the file**

Run: `rm src/components/editor/overlay/overlay-drop-zone.tsx`

### Step 4.3: Update INDEX.md if needed

- [ ] **Edit `src/components/editor/overlay/INDEX.md`**

Open the file. If it contains a line referencing `overlay-drop-zone.tsx` or `OverlayDropZone`, remove that line. If no such line exists, leave the file unchanged.

### Step 4.4: Verify build still clean

- [ ] **Run typecheck + tests**

Run: `pnpm tsc --noEmit && pnpm vitest run`

Expected: All pass.

### Step 4.5: Commit

- [ ] **Commit**

```bash
git add src/components/editor/overlay/
git commit -m "chore(overlay): remove unused OverlayDropZone (no static drop strips)"
```

---

## Task 5: Manual UAT in dev server

**Files:** none (manual verification)

This task verifies the full UX in the browser. Follow each scenario from the spec and confirm visually.

### Step 5.1: Start dev server

- [ ] **Start the Next.js dev server**

Run: `pnpm dev`

Wait for the server to be ready (usually `http://localhost:3000`). Open in Chrome 110+ or Edge 110+.

### Step 5.2: Set up test state

- [ ] **Reach editor with auto-matched timeline + audio**

Steps in browser:
1. Sign in (if needed) and reach the build editor
2. Load or paste a script
3. Upload audio (mp3) so an audio track exists
4. Trigger auto-match so a main clips row populates
5. Confirm visually: TrackTags row → main TrackClips row → TrackAudio row at bottom
6. Open the All Clips panel with at least 2 b-roll clips visible

### Step 5.3: UAT scenarios

For each scenario, drag a b-roll thumbnail from the All Clips panel and observe ghost color + final position.

- [ ] **Scenario A — Empty overlays:** No overlay tracks exist. Drag a clip over the area between TrackClips and TrackAudio. Expected: a ~56px tall area appears highlighted; orange ghost block follows the cursor; on drop, a single overlay track is created above main clips.

- [ ] **Scenario B — Drop into existing track:** With 1 overlay track, drag another clip into the body of that track at a non-overlapping time. Expected: cyan ghost (border-cyan-400); on drop, clip joins the same track. Verify: it does NOT create a new track.

- [ ] **Scenario C — Drop on top edge (above all overlays):** With ≥1 overlay track, hover the cursor in the 6px gap above the topmost overlay band. Expected: orange ghost at Y=0; on drop, a new track appears above all existing overlay tracks.

- [ ] **Scenario D — Drop in between-tracks gap:** With ≥2 overlay tracks, hover in the 6px gap between two tracks. Expected: orange ghost at the gap position; on drop, a new track is inserted between the two; existing tracks above the insertion point shift index up.

- [ ] **Scenario E — Drop on bottom edge (sat main):** With ≥1 overlay track, hover in the 6px gap just above main TrackClips. Expected: orange ghost just above main; on drop, a new track appears at the bottom of the overlay stack (immediately above main); other overlay tracks shift index up.

- [ ] **Scenario F — Overlap rejection:** Drag a clip into an existing track at a time that overlaps an existing overlay. Expected: red ghost (border-red-500); on drop, nothing happens.

- [ ] **Scenario G — Move existing clip across tracks:** Drag an existing overlay clip from one track to a between-gap. Expected: orange ghost; on drop, the clip moves and a new track is created at the gap (other tracks shifted as needed). Verify compact: no gaps in trackIndex sequence after.

- [ ] **Scenario H — Move existing clip onto another track:** Drag an existing overlay clip onto a different existing track at a non-overlapping time. Expected: cyan ghost; on drop, clip moves into the target track.

- [ ] **Scenario I — Scrub click still works:** Click in empty overlay area (not on any clip). Expected: playhead jumps to clicked time, just like clicking the main clips area used to.

If any scenario fails, capture the issue and revisit the relevant task before claiming done.

### Step 5.4: Verify timeline-panel scrub click handling not broken

- [ ] **Click on the gap between overlay tracks (not on a clip)**

Expected: playhead jumps to that X position (handled via the OverlayTracks `onClick` handler that calls `playerSeekRef.current`). No new overlay is created (drag-drop only happens on drag events, not click).

### Step 5.5: Stop dev server

- [ ] **Stop the dev server** (Ctrl+C in the terminal)

### Step 5.6: Final commit if any tweaks

- [ ] **If UAT revealed minor visual tweaks (e.g., GAP_HEIGHT adjustment), commit them**

If no tweaks needed, this step is a no-op.

```bash
git add -A
git commit -m "polish(overlay): UAT visual tweaks"
```

(Skip if no changes.)

---

## Self-Review

**Spec coverage:**
- ✅ Layout reorder (overlay above main): Task 3
- ✅ pickTrack refactor for createZones: Task 1
- ✅ Multi-zone drop logic in component: Task 2
- ✅ Gap rendering between bands: Task 2 (`GAP_HEIGHT`, `bandTop`)
- ✅ Empty state larger zone: Task 2 (`EMPTY_ZONE_HEIGHT = TRACK_HEIGHT`)
- ✅ Ghost top/height stored in GhostState: Task 2
- ✅ MOVE-mode handling for "create" pick: Task 2 Step 2.1 (filter + addOverlayWithNewTrack)
- ✅ Cleanup unused OverlayDropZone: Task 4
- ✅ All UAT scenarios: Task 5

**Placeholder scan:** No TBD/TODO. Code blocks complete in every step.

**Type consistency:**
- `CreateZone` defined in Task 1 lib, imported in Task 2 component ✓
- `TrackBand` already exists in lib, imported in Task 2 ✓
- `GhostState` extended fields (`top`, `height`) used consistently in render ✓
- `addOverlayWithNewTrack` signature unchanged (Task 2 uses existing) ✓
- Removed `OverlayDropZone` import in Task 2 — Task 4 verifies no usages remain ✓
