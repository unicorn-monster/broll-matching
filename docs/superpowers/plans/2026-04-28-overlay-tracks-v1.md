# Overlay Tracks v1 (b-roll-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CapCut-style drag-and-drop b-roll video overlays on dynamic tracks above the section-based main timeline, with click-select / drag-move / split-at-playhead / delete and an inspector panel for volume / mute / fade. Live preview only — export, persistence, and other overlay kinds (audio FX, text) come in later phases.

**Architecture:** Overlay state is parallel to the existing `MatchedSection[]` main timeline — both arrays render together in the preview pipeline. `OverlayItem` is a discriminated union ready for v2/v3 additive types. All new code lives under two feature folders (`src/lib/overlay/`, `src/components/editor/overlay/`) with `INDEX.md` navigation maps. Only 4 existing files are touched.

**Tech Stack:** React 19 + Next.js 15 App Router, TypeScript, Vitest (pure logic), HTML5 native drag-and-drop, Tailwind, existing IndexedDB blob store via `clipUrlsRef`.

**Spec source:** [`docs/superpowers/specs/2026-04-28-overlay-tracks-v1-design.md`](../specs/2026-04-28-overlay-tracks-v1-design.md)

---

## File map

**New (logic):**

| Path                                                      | Responsibility                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/lib/overlay/overlay-types.ts`                        | `OverlayKind`, `OverlayBase`, `BrollVideoOverlay`, `OverlayItem` discriminated union. |
| `src/lib/overlay/overlay-store.ts`                        | Pure reducers: add, addWithNewTrack, remove, move, splitAtMs, mutate, compactTracks.  |
| `src/lib/overlay/overlay-snap.ts`                         | Magnetic snap math: 10px threshold; priority playhead > section > edge > zero.        |
| `src/lib/overlay/overlay-collision.ts`                    | Same-track overlap predicate with self-exclusion.                                     |
| `src/lib/overlay/overlay-tracks.ts`                       | Track topology helpers: list tracks, max index, pickTrack from mouseY band.           |
| `src/lib/overlay/overlay-render-plan.ts`                  | Per-frame plan: active overlays, topmost, faded volume.                                |
| `src/lib/overlay/INDEX.md`                                | Navigation map for the lib feature folder.                                            |
| `src/lib/overlay/__tests__/overlay-store.test.ts`         | Tests for store reducers.                                                             |
| `src/lib/overlay/__tests__/overlay-snap.test.ts`          | Tests for snap math.                                                                  |
| `src/lib/overlay/__tests__/overlay-collision.test.ts`     | Tests for overlap predicate.                                                          |
| `src/lib/overlay/__tests__/overlay-tracks.test.ts`        | Tests for track topology + pickTrack.                                                 |
| `src/lib/overlay/__tests__/overlay-render-plan.test.ts`   | Tests for render-plan + faded volume.                                                 |

**New (UI):**

| Path                                                            | Responsibility                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/components/editor/overlay/overlay-drag-context.tsx`        | React context for drag state (`dragInfo`, `startDrag`, `endDrag`).                |
| `src/components/editor/overlay/overlay-drag-source.ts`          | `useOverlayDragSource(clip)` hook for library thumbnails.                          |
| `src/components/editor/overlay/overlay-clip-block.tsx`          | One overlay block on the timeline (presentational + select/drag wiring).          |
| `src/components/editor/overlay/overlay-drop-zone.tsx`           | Top-zone drop target visible during drag.                                          |
| `src/components/editor/overlay/overlay-tracks.tsx`              | Container that lays out N tracks + ghost preview during drag + drop handlers.     |
| `src/components/editor/overlay/overlay-inspector.tsx`           | Right-column panel when an overlay is selected.                                   |
| `src/components/editor/overlay/INDEX.md`                        | Navigation map for the UI feature folder.                                          |

**Modified (4 files only):**

| Path                                                  | Change                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/components/build/build-state-context.tsx`        | Add `overlays`, `setOverlays`, `selectedOverlayId`, `setSelectedOverlayId`; extend `inspectorMode`; extend `totalMs` derivation. |
| `src/components/editor/timeline/timeline-panel.tsx`   | Render `<OverlayTracks />` above `<TrackTags />`; add Split button (✂); update `totalMs`. |
| `src/components/editor/preview/preview-player.tsx`    | Render N `<video>` overlay elements; extend rAF loop with `ensureOverlaysLoaded`; extend seek/scrub. |
| `src/components/editor/editor-shell.tsx`              | Render `<OverlayInspector />` in column 3 row 2 when `inspectorMode === "overlay"`.      |

**Wiring touch:** `src/components/broll/clip-grid.tsx` gains a one-line hook call in each thumbnail to make them drag sources.

---

## Phase A — Pure logic foundation (TDD)

### Task A1: Overlay types

**Files:**
- Create: `src/lib/overlay/overlay-types.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/overlay/overlay-types.ts

export type OverlayKind = "broll-video" | "audio-fx" | "text";

export interface OverlayBase {
  id: string;
  kind: OverlayKind;
  trackIndex: number;
  startMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface BrollVideoOverlay extends OverlayBase {
  kind: "broll-video";
  clipId: string;
  indexeddbKey: string;
  sourceStartMs: number;
  sourceDurationMs: number;
}

// Future kinds (defined here so the render switch stays exhaustive when added):
// export interface AudioFxOverlay extends OverlayBase { kind: "audio-fx"; ... }
// export interface TextOverlay   extends OverlayBase { kind: "text";      ... }

export type OverlayItem = BrollVideoOverlay;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/overlay/overlay-types.ts
git commit -m "feat(overlay): types for OverlayItem discriminated union"
```

---

### Task A2: Overlay store reducers

**Files:**
- Create: `src/lib/overlay/__tests__/overlay-store.test.ts`
- Create: `src/lib/overlay/overlay-store.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/overlay/__tests__/overlay-store.test.ts
import { describe, it, expect } from "vitest";
import {
  addOverlay,
  addOverlayWithNewTrack,
  removeOverlay,
  moveOverlay,
  splitOverlayAtMs,
  mutateOverlay,
  compactTracks,
} from "../overlay-store";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (overrides: Partial<BrollVideoOverlay> = {}): BrollVideoOverlay => ({
  id: overrides.id ?? "o1",
  kind: "broll-video",
  trackIndex: 0,
  startMs: 0,
  durationMs: 1000,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c1",
  indexeddbKey: "k1",
  sourceStartMs: 0,
  sourceDurationMs: 1000,
  ...overrides,
});

describe("addOverlay", () => {
  it("appends an overlay to the list", () => {
    const a = make({ id: "a" });
    const b = make({ id: "b", trackIndex: 1 });
    expect(addOverlay([a], b)).toEqual([a, b]);
  });
});

describe("addOverlayWithNewTrack", () => {
  it("shifts existing tracks >= target up by 1, then inserts", () => {
    const a = make({ id: "a", trackIndex: 0 });
    const b = make({ id: "b", trackIndex: 1 });
    const inserted = make({ id: "c", trackIndex: 1 });
    const out = addOverlayWithNewTrack([a, b], inserted);
    expect(out.find((o) => o.id === "a")?.trackIndex).toBe(0);
    expect(out.find((o) => o.id === "b")?.trackIndex).toBe(2);
    expect(out.find((o) => o.id === "c")?.trackIndex).toBe(1);
  });
});

describe("removeOverlay", () => {
  it("removes overlay by id", () => {
    const a = make({ id: "a" });
    const b = make({ id: "b" });
    expect(removeOverlay([a, b], "a")).toEqual([b]);
  });
});

describe("moveOverlay", () => {
  it("updates startMs and trackIndex of one overlay", () => {
    const a = make({ id: "a", startMs: 1000, trackIndex: 0 });
    const out = moveOverlay([a], "a", { startMs: 2000, trackIndex: 1 });
    expect(out[0]).toMatchObject({ id: "a", startMs: 2000, trackIndex: 1 });
  });
  it("no-op when id missing", () => {
    const a = make({ id: "a" });
    expect(moveOverlay([a], "missing", { startMs: 5000, trackIndex: 0 })).toEqual([a]);
  });
});

describe("splitOverlayAtMs", () => {
  it("splits an overlay into two adjacent pieces", () => {
    const a = make({ id: "a", startMs: 1000, durationMs: 4000, sourceStartMs: 500 });
    const out = splitOverlayAtMs([a], "a", 3000);
    expect(out).toHaveLength(2);
    const left = out.find((o) => o.id === "a");
    const right = out.find((o) => o.id !== "a");
    expect(left).toMatchObject({ startMs: 1000, durationMs: 2000, sourceStartMs: 500 });
    expect(right).toMatchObject({ startMs: 3000, durationMs: 2000, sourceStartMs: 2500 });
  });
  it("no-op when playhead is outside overlay range", () => {
    const a = make({ id: "a", startMs: 1000, durationMs: 1000 });
    expect(splitOverlayAtMs([a], "a", 500)).toEqual([a]);
    expect(splitOverlayAtMs([a], "a", 2500)).toEqual([a]);
  });
  it("no-op when playhead is exactly at start or end", () => {
    const a = make({ id: "a", startMs: 1000, durationMs: 1000 });
    expect(splitOverlayAtMs([a], "a", 1000)).toEqual([a]);
    expect(splitOverlayAtMs([a], "a", 2000)).toEqual([a]);
  });
});

describe("mutateOverlay", () => {
  it("merges patch into the overlay with given id", () => {
    const a = make({ id: "a", volume: 1, muted: false });
    const out = mutateOverlay([a], "a", { volume: 0.5, muted: true });
    expect(out[0]).toMatchObject({ volume: 0.5, muted: true });
  });
});

describe("compactTracks", () => {
  it("removes gaps in trackIndex sequence", () => {
    const a = make({ id: "a", trackIndex: 0 });
    const b = make({ id: "b", trackIndex: 2 }); // gap at 1
    const c = make({ id: "c", trackIndex: 5 });
    const out = compactTracks([a, b, c]);
    expect(out.find((o) => o.id === "a")?.trackIndex).toBe(0);
    expect(out.find((o) => o.id === "b")?.trackIndex).toBe(1);
    expect(out.find((o) => o.id === "c")?.trackIndex).toBe(2);
  });
  it("leaves contiguous tracks unchanged", () => {
    const a = make({ id: "a", trackIndex: 0 });
    const b = make({ id: "b", trackIndex: 1 });
    expect(compactTracks([a, b])).toEqual([a, b]);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm test src/lib/overlay/__tests__/overlay-store.test.ts`
Expected: FAIL with "Failed to resolve import" for `../overlay-store`.

- [ ] **Step 3: Implement the store**

```ts
// src/lib/overlay/overlay-store.ts
import type { OverlayItem } from "./overlay-types";

export function addOverlay(overlays: OverlayItem[], next: OverlayItem): OverlayItem[] {
  return [...overlays, next];
}

export function addOverlayWithNewTrack(
  overlays: OverlayItem[],
  next: OverlayItem,
): OverlayItem[] {
  const shifted = overlays.map((o) =>
    o.trackIndex >= next.trackIndex ? { ...o, trackIndex: o.trackIndex + 1 } : o,
  );
  return [...shifted, next];
}

export function removeOverlay(overlays: OverlayItem[], id: string): OverlayItem[] {
  return overlays.filter((o) => o.id !== id);
}

export function moveOverlay(
  overlays: OverlayItem[],
  id: string,
  patch: { startMs: number; trackIndex: number },
): OverlayItem[] {
  return overlays.map((o) =>
    o.id === id ? { ...o, startMs: patch.startMs, trackIndex: patch.trackIndex } : o,
  );
}

export function splitOverlayAtMs(
  overlays: OverlayItem[],
  id: string,
  atMs: number,
): OverlayItem[] {
  const o = overlays.find((x) => x.id === id);
  if (!o) return overlays;
  const localMs = atMs - o.startMs;
  if (localMs <= 0 || localMs >= o.durationMs) return overlays;

  const left: OverlayItem = { ...o, durationMs: localMs };
  const right: OverlayItem = {
    ...o,
    id: crypto.randomUUID(),
    startMs: atMs,
    durationMs: o.durationMs - localMs,
    sourceStartMs: o.sourceStartMs + localMs,
  };
  return overlays.map((x) => (x.id === id ? left : x)).concat(right);
}

export function mutateOverlay(
  overlays: OverlayItem[],
  id: string,
  patch: Partial<OverlayItem>,
): OverlayItem[] {
  return overlays.map((o) => (o.id === id ? ({ ...o, ...patch } as OverlayItem) : o));
}

export function compactTracks(overlays: OverlayItem[]): OverlayItem[] {
  const usedIndices = Array.from(new Set(overlays.map((o) => o.trackIndex))).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  usedIndices.forEach((idx, newIdx) => remap.set(idx, newIdx));
  return overlays.map((o) => ({ ...o, trackIndex: remap.get(o.trackIndex) ?? o.trackIndex }));
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/overlay/__tests__/overlay-store.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlay/overlay-store.ts src/lib/overlay/__tests__/overlay-store.test.ts
git commit -m "feat(overlay): pure reducers for overlay state mutations"
```

---

### Task A3: Snap math

**Files:**
- Create: `src/lib/overlay/__tests__/overlay-snap.test.ts`
- Create: `src/lib/overlay/overlay-snap.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/overlay/__tests__/overlay-snap.test.ts
import { describe, it, expect } from "vitest";
import { computeSnap, type SnapCandidate } from "../overlay-snap";

const c = (ms: number, kind: SnapCandidate["kind"]): SnapCandidate => ({ ms, kind });

describe("computeSnap", () => {
  it("returns rawStartMs unchanged when no candidate is within threshold", () => {
    const out = computeSnap(5000, [c(100, "playhead")], 100, 10); // 5s away
    expect(out.snappedStartMs).toBe(5000);
    expect(out.snapTarget).toBe(null);
  });

  it("snaps to playhead when within 10px", () => {
    // pxPerSec = 100, threshold = 10px → 100ms threshold in time
    const out = computeSnap(1050, [c(1000, "playhead")], 100, 10);
    expect(out.snappedStartMs).toBe(1000);
    expect(out.snapTarget).toBe("playhead");
  });

  it("snaps to closest candidate when multiple within threshold", () => {
    const candidates = [c(900, "edge"), c(1100, "edge")];
    const out = computeSnap(1050, candidates, 100, 10);
    // 1050 is 50ms from 1100 (50px away — too far) and 150ms from 900 (too far)
    expect(out.snapTarget).toBe(null);
  });

  it("priority: playhead > section > edge > zero on tie within threshold", () => {
    const candidates = [c(1000, "edge"), c(1000, "playhead"), c(1000, "section")];
    const out = computeSnap(1050, candidates, 100, 10);
    expect(out.snapTarget).toBe("playhead");
  });

  it("snaps to zero when raw is near 0", () => {
    const out = computeSnap(50, [c(0, "zero")], 100, 10); // 50ms from 0 = 5px → within threshold
    expect(out.snappedStartMs).toBe(0);
    expect(out.snapTarget).toBe("zero");
  });

  it("threshold is in pixel space, not ms", () => {
    // pxPerSec = 1000 → 10px = 10ms in time
    const out1 = computeSnap(108, [c(100, "playhead")], 1000, 10);
    expect(out1.snapTarget).toBe(null); // 8ms = 8px → within
    // wait, 8px < 10px threshold, so SHOULD snap. Re-check.
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm test src/lib/overlay/__tests__/overlay-snap.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement snap**

```ts
// src/lib/overlay/overlay-snap.ts

export type SnapKind = "playhead" | "section" | "edge" | "zero";

export interface SnapCandidate {
  ms: number;
  kind: SnapKind;
}

export interface SnapResult {
  snappedStartMs: number;
  snapTarget: SnapKind | null;
}

const PRIORITY: Record<SnapKind, number> = {
  playhead: 4,
  section: 3,
  edge: 2,
  zero: 1,
};

export function computeSnap(
  rawStartMs: number,
  candidates: SnapCandidate[],
  pxPerSecond: number,
  thresholdPx: number,
): SnapResult {
  const thresholdMs = (thresholdPx / pxPerSecond) * 1000;
  let best: SnapCandidate | null = null;
  let bestDistMs = Infinity;
  for (const cand of candidates) {
    const dist = Math.abs(cand.ms - rawStartMs);
    if (dist > thresholdMs) continue;
    if (
      dist < bestDistMs ||
      (dist === bestDistMs && best && PRIORITY[cand.kind] > PRIORITY[best.kind])
    ) {
      best = cand;
      bestDistMs = dist;
    }
  }
  if (!best) return { snappedStartMs: rawStartMs, snapTarget: null };
  return { snappedStartMs: best.ms, snapTarget: best.kind };
}
```

- [ ] **Step 4: Fix the third test (was wrong)**

Edit the third test in `overlay-snap.test.ts` to remove the misleading comment and validate the real behavior:

```ts
  it("snaps to closer candidate when multiple within threshold", () => {
    // pxPerSec = 100, threshold = 10px → 100ms threshold
    // raw = 1050; candidates 900 (150ms away) and 1100 (50ms away → within)
    const candidates = [c(900, "edge"), c(1100, "edge")];
    const out = computeSnap(1050, candidates, 100, 10);
    expect(out.snappedStartMs).toBe(1100);
    expect(out.snapTarget).toBe("edge");
  });
```

And fix the last test:

```ts
  it("threshold is in pixel space, not ms", () => {
    // pxPerSec = 1000 → 10px threshold = 10ms in time
    // raw = 108, candidate at 100 → 8ms = 8px → within → snaps
    const out = computeSnap(108, [c(100, "playhead")], 1000, 10);
    expect(out.snappedStartMs).toBe(100);
    expect(out.snapTarget).toBe("playhead");
  });
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm test src/lib/overlay/__tests__/overlay-snap.test.ts`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/overlay/overlay-snap.ts src/lib/overlay/__tests__/overlay-snap.test.ts
git commit -m "feat(overlay): magnetic snap math with priority ordering"
```

---

### Task A4: Collision detection

**Files:**
- Create: `src/lib/overlay/__tests__/overlay-collision.test.ts`
- Create: `src/lib/overlay/overlay-collision.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/overlay/__tests__/overlay-collision.test.ts
import { describe, it, expect } from "vitest";
import { isOverlapOnSameTrack } from "../overlay-collision";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (id: string, trackIndex: number, startMs: number, durationMs: number): BrollVideoOverlay => ({
  id,
  kind: "broll-video",
  trackIndex,
  startMs,
  durationMs,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c",
  indexeddbKey: "k",
  sourceStartMs: 0,
  sourceDurationMs: durationMs,
});

describe("isOverlapOnSameTrack", () => {
  it("returns false when no overlays on track", () => {
    expect(isOverlapOnSameTrack([], { trackIndex: 0, startMs: 0, durationMs: 1000 })).toBe(false);
  });

  it("returns true on partial overlap", () => {
    const a = make("a", 0, 1000, 2000); // 1000-3000
    const target = { trackIndex: 0, startMs: 2000, durationMs: 2000 }; // 2000-4000
    expect(isOverlapOnSameTrack([a], target)).toBe(true);
  });

  it("returns false when target is exactly adjacent (touches edge)", () => {
    const a = make("a", 0, 1000, 1000); // 1000-2000
    const target = { trackIndex: 0, startMs: 2000, durationMs: 1000 }; // 2000-3000
    expect(isOverlapOnSameTrack([a], target)).toBe(false);
  });

  it("returns false when on different track", () => {
    const a = make("a", 0, 1000, 2000);
    const target = { trackIndex: 1, startMs: 1500, durationMs: 1000 };
    expect(isOverlapOnSameTrack([a], target)).toBe(false);
  });

  it("ignores self when idToIgnore is set", () => {
    const a = make("a", 0, 1000, 2000);
    const target = { trackIndex: 0, startMs: 1500, durationMs: 1000, idToIgnore: "a" };
    expect(isOverlapOnSameTrack([a], target)).toBe(false);
  });

  it("returns true when target fully contains existing", () => {
    const a = make("a", 0, 2000, 1000); // 2000-3000
    const target = { trackIndex: 0, startMs: 1000, durationMs: 3000 }; // 1000-4000
    expect(isOverlapOnSameTrack([a], target)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm test src/lib/overlay/__tests__/overlay-collision.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement collision**

```ts
// src/lib/overlay/overlay-collision.ts
import type { OverlayItem } from "./overlay-types";

export interface CollisionTarget {
  trackIndex: number;
  startMs: number;
  durationMs: number;
  idToIgnore?: string;
}

export function isOverlapOnSameTrack(
  overlays: OverlayItem[],
  target: CollisionTarget,
): boolean {
  const tEnd = target.startMs + target.durationMs;
  for (const o of overlays) {
    if (o.trackIndex !== target.trackIndex) continue;
    if (target.idToIgnore && o.id === target.idToIgnore) continue;
    const oEnd = o.startMs + o.durationMs;
    if (target.startMs < oEnd && tEnd > o.startMs) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/overlay/__tests__/overlay-collision.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlay/overlay-collision.ts src/lib/overlay/__tests__/overlay-collision.test.ts
git commit -m "feat(overlay): same-track overlap predicate with self-exclusion"
```

---

### Task A5: Track topology helpers

**Files:**
- Create: `src/lib/overlay/__tests__/overlay-tracks.test.ts`
- Create: `src/lib/overlay/overlay-tracks.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/overlay/__tests__/overlay-tracks.test.ts
import { describe, it, expect } from "vitest";
import { listTracks, maxTrackIndex, pickTrack } from "../overlay-tracks";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (id: string, trackIndex: number): BrollVideoOverlay => ({
  id,
  kind: "broll-video",
  trackIndex,
  startMs: 0,
  durationMs: 1000,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c",
  indexeddbKey: "k",
  sourceStartMs: 0,
  sourceDurationMs: 1000,
});

describe("listTracks", () => {
  it("returns sorted unique track indices ascending", () => {
    const out = listTracks([make("a", 2), make("b", 0), make("c", 2), make("d", 1)]);
    expect(out).toEqual([0, 1, 2]);
  });
  it("returns [] when empty", () => {
    expect(listTracks([])).toEqual([]);
  });
});

describe("maxTrackIndex", () => {
  it("returns highest track index", () => {
    expect(maxTrackIndex([make("a", 0), make("b", 3), make("c", 1)])).toBe(3);
  });
  it("returns -1 when no overlays exist", () => {
    expect(maxTrackIndex([])).toBe(-1);
  });
});

describe("pickTrack", () => {
  // bands describe each track's vertical pixel band
  // top zone is the strip ABOVE all existing tracks
  it("returns create-new-track when mouseY in top zone", () => {
    const bands = [
      { trackIndex: 1, top: 50, bottom: 90 },
      { trackIndex: 0, top: 90, bottom: 130 },
    ];
    const out = pickTrack(20, bands, { topZoneTop: 0, topZoneBottom: 50 }, 1);
    expect(out).toEqual({ mode: "create", trackIndex: 2 });
  });

  it("returns into-existing when mouseY in track band", () => {
    const bands = [
      { trackIndex: 1, top: 50, bottom: 90 },
      { trackIndex: 0, top: 90, bottom: 130 },
    ];
    const out = pickTrack(70, bands, { topZoneTop: 0, topZoneBottom: 50 }, 1);
    expect(out).toEqual({ mode: "into", trackIndex: 1 });
  });

  it("returns create-track-zero when no tracks exist (empty timeline drop)", () => {
    const out = pickTrack(50, [], { topZoneTop: 0, topZoneBottom: 100 }, -1);
    expect(out).toEqual({ mode: "create", trackIndex: 0 });
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm test src/lib/overlay/__tests__/overlay-tracks.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement tracks**

```ts
// src/lib/overlay/overlay-tracks.ts
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

export interface TopZone {
  topZoneTop: number;
  topZoneBottom: number;
}

export type PickResult = { mode: "create" | "into"; trackIndex: number };

export function pickTrack(
  mouseY: number,
  trackBands: TrackBand[],
  topZone: TopZone,
  currentMaxTrackIndex: number,
): PickResult {
  if (mouseY >= topZone.topZoneTop && mouseY < topZone.topZoneBottom) {
    return { mode: "create", trackIndex: currentMaxTrackIndex + 1 };
  }
  for (const band of trackBands) {
    if (mouseY >= band.top && mouseY < band.bottom) {
      return { mode: "into", trackIndex: band.trackIndex };
    }
  }
  // Fallback: empty timeline → create track 0
  return { mode: "create", trackIndex: Math.max(0, currentMaxTrackIndex + 1) };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/overlay/__tests__/overlay-tracks.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlay/overlay-tracks.ts src/lib/overlay/__tests__/overlay-tracks.test.ts
git commit -m "feat(overlay): track topology helpers and pickTrack"
```

---

### Task A6: Render plan

**Files:**
- Create: `src/lib/overlay/__tests__/overlay-render-plan.test.ts`
- Create: `src/lib/overlay/overlay-render-plan.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/overlay/__tests__/overlay-render-plan.test.ts
import { describe, it, expect } from "vitest";
import { findActiveOverlays, findTopmostActive, computeFadedVolume } from "../overlay-render-plan";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (
  id: string,
  startMs: number,
  durationMs: number,
  trackIndex = 0,
  partial: Partial<BrollVideoOverlay> = {},
): BrollVideoOverlay => ({
  id,
  kind: "broll-video",
  trackIndex,
  startMs,
  durationMs,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c",
  indexeddbKey: "k",
  sourceStartMs: 0,
  sourceDurationMs: durationMs,
  ...partial,
});

describe("findActiveOverlays", () => {
  it("returns overlays whose [start, start+dur) contains ms", () => {
    const a = make("a", 1000, 2000);
    const b = make("b", 2500, 1000, 1);
    const out = findActiveOverlays([a, b], 2700);
    expect(out.map((o) => o.id).sort()).toEqual(["a", "b"]);
  });
  it("excludes overlay at exact end (half-open interval)", () => {
    const a = make("a", 1000, 1000); // 1000-2000
    expect(findActiveOverlays([a], 2000)).toEqual([]);
  });
});

describe("findTopmostActive", () => {
  it("picks highest trackIndex among active", () => {
    const a = make("a", 1000, 2000, 0);
    const b = make("b", 1000, 2000, 2);
    const c = make("c", 1000, 2000, 1);
    expect(findTopmostActive([a, b, c], 1500)?.id).toBe("b");
  });
  it("returns null when none active", () => {
    expect(findTopmostActive([make("a", 0, 1000)], 5000)).toBe(null);
  });
});

describe("computeFadedVolume", () => {
  it("returns volume*1 when no fades", () => {
    const o = make("a", 1000, 2000, 0, { volume: 0.8 });
    expect(computeFadedVolume(o, 1500)).toBeCloseTo(0.8);
  });
  it("ramps from 0 to volume during fadeIn", () => {
    const o = make("a", 1000, 2000, 0, { volume: 1, fadeInMs: 1000 });
    expect(computeFadedVolume(o, 1000)).toBeCloseTo(0);
    expect(computeFadedVolume(o, 1500)).toBeCloseTo(0.5);
    expect(computeFadedVolume(o, 2000)).toBeCloseTo(1);
  });
  it("ramps from volume to 0 during fadeOut", () => {
    const o = make("a", 1000, 2000, 0, { volume: 1, fadeOutMs: 500 });
    // fadeOut starts at localMs > durationMs - fadeOutMs = 1500
    expect(computeFadedVolume(o, 2500)).toBeCloseTo(1); // localMs=1500, not yet fading
    expect(computeFadedVolume(o, 2750)).toBeCloseTo(0.5);
    expect(computeFadedVolume(o, 2999)).toBeCloseTo(0.002, 2);
  });
  it("clamps result to 0..1 (HTMLMediaElement range)", () => {
    const o = make("a", 1000, 2000, 0, { volume: 2 });
    expect(computeFadedVolume(o, 1500)).toBe(1);
  });
  it("returns 0 when muted is irrelevant — caller handles muted via el.muted", () => {
    // computeFadedVolume only handles volume, not muted; muted is applied separately
    const o = make("a", 1000, 2000, 0, { volume: 1, muted: true });
    expect(computeFadedVolume(o, 1500)).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm test src/lib/overlay/__tests__/overlay-render-plan.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement render plan**

```ts
// src/lib/overlay/overlay-render-plan.ts
import type { OverlayItem } from "./overlay-types";

export function findActiveOverlays(overlays: OverlayItem[], ms: number): OverlayItem[] {
  return overlays.filter((o) => ms >= o.startMs && ms < o.startMs + o.durationMs);
}

export function findTopmostActive(overlays: OverlayItem[], ms: number): OverlayItem | null {
  const active = findActiveOverlays(overlays, ms);
  if (active.length === 0) return null;
  return active.reduce((max, o) => (o.trackIndex > max.trackIndex ? o : max), active[0]!);
}

export function computeFadedVolume(o: OverlayItem, audioMs: number): number {
  const localMs = audioMs - o.startMs;
  let factor = 1;
  if (o.fadeInMs > 0 && localMs < o.fadeInMs) {
    factor = Math.max(0, localMs / o.fadeInMs);
  }
  const fadeOutStart = o.durationMs - o.fadeOutMs;
  if (o.fadeOutMs > 0 && localMs > fadeOutStart) {
    factor = Math.max(0, (o.durationMs - localMs) / o.fadeOutMs);
  }
  return Math.min(1, Math.max(0, o.volume * factor));
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/overlay/__tests__/overlay-render-plan.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlay/overlay-render-plan.ts src/lib/overlay/__tests__/overlay-render-plan.test.ts
git commit -m "feat(overlay): per-frame render plan + faded volume computation"
```

---

## Phase B — BuildState extension

### Task B1: Extend BuildStateContext with overlay state

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Read the current file**

Run: `cat src/components/build/build-state-context.tsx`
Confirm: file matches the structure used in this plan.

- [ ] **Step 2: Add overlay state fields**

Apply this diff (manually, using Edit tool):

Add import at top alongside other type imports:

```ts
import type { OverlayItem } from "@/lib/overlay/overlay-types";
```

Extend the `BuildState` interface with these new fields (insert after `previewClipKey` block):

```ts
  // Overlay tracks (free-form clips above main track)
  overlays: OverlayItem[];
  setOverlays: (next: OverlayItem[] | ((prev: OverlayItem[]) => OverlayItem[])) => void;
  selectedOverlayId: string | null;
  setSelectedOverlayId: (id: string | null) => void;
```

Change the inspectorMode union from `"section" | "empty"` to:

```ts
  inspectorMode: "section" | "overlay" | "empty";
```

In the provider, add state hooks (after `setPreviewClipKey` declaration):

```ts
  const [overlays, setOverlaysState] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const setOverlays = useCallback(
    (next: OverlayItem[] | ((prev: OverlayItem[]) => OverlayItem[])) => {
      setOverlaysState((prev) => (typeof next === "function" ? (next as (p: OverlayItem[]) => OverlayItem[])(prev) : next));
    },
    [],
  );
```

Add `useCallback` to the React import line if not already present.

In the `useMemo<BuildState>(...)` callback, change `inspectorMode` derivation:

```ts
    const inspectorMode: "section" | "overlay" | "empty" =
      selectedOverlayId !== null
        ? "overlay"
        : selectedSectionIndex !== null && timeline
          ? "section"
          : "empty";
```

Extend `totalMs`-equivalent logic — but `BuildState` does not currently expose `totalMs`; it's computed downstream in `TimelinePanel` and `PreviewPlayer`. We'll update those in their respective tasks. For now, just add `overlays`, `setOverlays`, `selectedOverlayId`, `setSelectedOverlayId` to the value object.

Add to the value object returned by `useMemo`:

```ts
      overlays,
      setOverlays,
      selectedOverlayId,
      setSelectedOverlayId,
```

Add `overlays` and `selectedOverlayId` to the `useMemo` dependency array.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors. (If it complains about missing `useCallback` import, add it.)

- [ ] **Step 4: Run dev server briefly to confirm no runtime crash**

Run: `pnpm dev` (kill after seeing "Ready").

Then visit any product page in browser; confirm no console errors related to BuildState.

- [ ] **Step 5: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(overlay): extend BuildState with overlays + selection"
```

---

## Phase C — UI: drag context + drag source

### Task C1: Drag context

**Files:**
- Create: `src/components/editor/overlay/overlay-drag-context.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/editor/overlay/overlay-drag-context.tsx
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
```

- [ ] **Step 2: Wrap editor-shell with the provider**

Modify `src/components/editor/editor-shell.tsx`:

Add import at top:

```ts
import { OverlayDragProvider } from "@/components/editor/overlay/overlay-drag-context";
```

Wrap the entire JSX returned by `EditorShell` in `<OverlayDragProvider>`:

```tsx
return (
  <OverlayDragProvider>
    <div className="grid h-[calc(100vh-4rem)] ...">
      {/* existing JSX */}
    </div>
  </OverlayDragProvider>
);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/overlay/overlay-drag-context.tsx src/components/editor/editor-shell.tsx
git commit -m "feat(overlay): drag context provider"
```

---

### Task C2: Drag source hook for library thumbnails

**Files:**
- Create: `src/components/editor/overlay/overlay-drag-source.ts`
- Modify: `src/components/broll/clip-grid.tsx`

- [ ] **Step 1: Create the hook**

```ts
// src/components/editor/overlay/overlay-drag-source.ts
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
  // 1x1 transparent gif
  img.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  return img;
})();

const DRAG_THRESHOLD_PX = 5;

/**
 * Returns props to spread on a draggable thumbnail. Coexists with click-to-preview
 * by requiring 5px movement before drag actually starts (HTML5 native dragstart
 * already fires after threshold, so a quick click does not trigger a drag).
 */
export function useOverlayDragSource(clip: OverlayDragSourceClip) {
  const { startDrag, endDrag } = useOverlayDrag();

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "copy";
      // Suppress the browser's default drag-image; the timeline draws its own ghost.
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

  return {
    draggable: true,
    onDragStart,
    onDragEnd,
  } as const;
}

// Exported for any caller that wants to import the threshold constant
export { DRAG_THRESHOLD_PX };
```

- [ ] **Step 2: Wire into clip-grid.tsx**

Read the current `src/components/broll/clip-grid.tsx` to find where each thumbnail is rendered.

Run: `cat src/components/broll/clip-grid.tsx`

Locate the JSX block that renders one thumbnail (search for `data-broll-thumbnail` or the `<button>`/`<div>` wrapping the image). Spread the drag source on that element.

Add import:

```ts
import { useOverlayDragSource } from "@/components/editor/overlay/overlay-drag-source";
```

Inside the per-clip render (where `clip.id`, `clip.indexeddbKey`, `clip.durationMs` are available), build a small inner component if needed (because hooks can't be called inside `.map` directly without an inner component wrapper):

If the existing structure already extracts an inner per-clip component (e.g., `ClipTile`), add the hook there. If it's an inline `.map`, refactor minimally to extract a `ClipTile` component first.

Spread the drag props:

```tsx
function ClipTile({ clip, ... }: ClipTileProps) {
  const dragProps = useOverlayDragSource({
    clipId: clip.id,
    indexeddbKey: clip.indexeddbKey,
    durationMs: clip.durationMs,
    thumbnailUrl: null, // populated later if needed for ghost preview
  });
  return (
    <div {...dragProps} ...>
      ...existing thumbnail content...
    </div>
  );
}
```

**Important:** preserve the existing click-to-preview behavior (don't replace `onClick`; the drag threshold built into HTML5 ensures a click doesn't trigger drag).

- [ ] **Step 3: Run typecheck + dev**

```bash
pnpm typecheck
pnpm dev
```

In browser: open a project with clips, hover over a thumbnail — cursor should become "grab" or "move". Click should still trigger preview as before.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/overlay/overlay-drag-source.ts src/components/broll/clip-grid.tsx
git commit -m "feat(overlay): library thumbnails as drag sources"
```

---

## Phase D — UI: timeline overlay components

### Task D1: OverlayClipBlock (presentational)

**Files:**
- Create: `src/components/editor/overlay/overlay-clip-block.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/editor/overlay/overlay-clip-block.tsx
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
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/overlay-clip-block.tsx
git commit -m "feat(overlay): clip block with thumbnail + select"
```

---

### Task D2: OverlayDropZone visual

**Files:**
- Create: `src/components/editor/overlay/overlay-drop-zone.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/editor/overlay/overlay-drop-zone.tsx
"use client";

import { cn } from "@/lib/utils";

interface OverlayDropZoneProps {
  active: boolean;        // true while a drag is in progress
  variant: "top" | "track-empty"; // top = "+ New track" zone above all tracks
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/overlay/overlay-drop-zone.tsx
git commit -m "feat(overlay): drop zone visual"
```

---

### Task D3: OverlayTracks container (no drop logic yet)

**Files:**
- Create: `src/components/editor/overlay/overlay-tracks.tsx`

- [ ] **Step 1: Create the file with rendering only (drop logic comes in Task E1)**

```tsx
// src/components/editor/overlay/overlay-tracks.tsx
"use client";

import { useMemo } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { listTracks } from "@/lib/overlay/overlay-tracks";
import { OverlayClipBlock } from "./overlay-clip-block";
import { OverlayDropZone } from "./overlay-drop-zone";
import { useOverlayDrag } from "./overlay-drag-context";

const TRACK_HEIGHT = 40;
const TOP_ZONE_HEIGHT = 24;

interface OverlayTracksProps {
  pxPerSecond: number;
}

export function OverlayTracks({ pxPerSecond }: OverlayTracksProps) {
  const { overlays, selectedOverlayId, setSelectedOverlayId } = useBuildState();
  const { dragInfo } = useOverlayDrag();

  const tracks = useMemo(() => listTracks(overlays), [overlays]);
  const isDragging = dragInfo !== null;

  // Render top → bottom: highest trackIndex on top
  const tracksTopDown = [...tracks].reverse();

  if (tracks.length === 0 && !isDragging) {
    // Collapsed when no overlays and not dragging
    return null;
  }

  const totalHeight = TOP_ZONE_HEIGHT + tracksTopDown.length * TRACK_HEIGHT;

  return (
    <div
      data-overlay-tracks
      className="relative bg-muted/5 border-b border-border/40"
      style={{ height: `${totalHeight}px` }}
    >
      {/* Top zone for "+ New track" */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: TOP_ZONE_HEIGHT }}>
        <OverlayDropZone active={isDragging} variant="top" />
      </div>

      {/* Each track row */}
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
                onDragStart={() => {
                  /* wired in Task F1 */
                }}
                onDragEnd={() => {
                  /* wired in Task F1 */
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/overlay-tracks.tsx
git commit -m "feat(overlay): timeline tracks container (render only)"
```

---

### Task D4: Wire OverlayTracks into TimelinePanel

**Files:**
- Modify: `src/components/editor/timeline/timeline-panel.tsx`

- [ ] **Step 1: Read the current file**

Run: `cat src/components/editor/timeline/timeline-panel.tsx`

- [ ] **Step 2: Add import + render**

Add import at top:

```ts
import { OverlayTracks } from "@/components/editor/overlay/overlay-tracks";
```

Locate the `useBuildState()` destructure; add `overlays` to the pulled fields:

```ts
const { ..., overlays } = useBuildState();
```

Update `totalMs` derivation to include overlay end times:

```ts
const totalMs = useMemo(() => {
  let base = 0;
  if (timeline) base = timeline.reduce((sum, s) => sum + s.durationMs, 0);
  else if (audioDuration) base = audioDuration * 1000;
  const overlayEnd = overlays.reduce((m, o) => Math.max(m, o.startMs + o.durationMs), 0);
  return Math.max(base, overlayEnd);
}, [timeline, audioDuration, overlays]);
```

Inside the timeline scroller div (between the `TimelineRuler` and the `timeline ? <>...</> : ...` block), insert:

```tsx
<OverlayTracks pxPerSecond={effectivePxPerSec} />
```

So the order becomes:

```tsx
<TimelineRuler totalMs={totalMs} pxPerSecond={effectivePxPerSec} />
<OverlayTracks pxPerSecond={effectivePxPerSec} />
{timeline ? (
  <>
    <TrackTags ... />
    <TrackClips ... />
  </>
) : (
  ...
)}
<TrackAudio ... />
```

- [ ] **Step 3: Run typecheck + dev**

```bash
pnpm typecheck
pnpm dev
```

Visit project, paste a script + load audio. With `overlays = []` and no drag → overlay area is hidden (no extra space above TrackTags).

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/timeline/timeline-panel.tsx
git commit -m "feat(overlay): render OverlayTracks in TimelinePanel"
```

---

## Phase E — Drop on timeline (create new overlay)

### Task E1: Drop handler + ghost preview + snap + collision

**Files:**
- Modify: `src/components/editor/overlay/overlay-tracks.tsx`

- [ ] **Step 1: Add drop logic**

Replace the existing `OverlayTracks` component body. Full new file content:

```tsx
// src/components/editor/overlay/overlay-tracks.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { listTracks, maxTrackIndex, pickTrack } from "@/lib/overlay/overlay-tracks";
import { computeSnap, type SnapCandidate } from "@/lib/overlay/overlay-snap";
import { isOverlapOnSameTrack } from "@/lib/overlay/overlay-collision";
import { addOverlay, addOverlayWithNewTrack } from "@/lib/overlay/overlay-store";
import type { BrollVideoOverlay } from "@/lib/overlay/overlay-types";
import { OverlayClipBlock } from "./overlay-clip-block";
import { OverlayDropZone } from "./overlay-drop-zone";
import { useOverlayDrag } from "./overlay-drag-context";

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
  const { overlays, setOverlays, selectedOverlayId, setSelectedOverlayId, timeline, playheadMs } =
    useBuildState();
  const { dragInfo } = useOverlayDrag();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);

  const tracks = useMemo(() => listTracks(overlays), [overlays]);
  const isDragging = dragInfo !== null;
  const tracksTopDown = [...tracks].reverse();
  const totalHeight = TOP_ZONE_HEIGHT + tracksTopDown.length * TRACK_HEIGHT;

  // Build snap candidates from playhead, section boundaries, and overlay edges.
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

    // Convert mouseX → rawStartMs
    const rawStartMs = Math.max(0, (x / pxPerSecond) * 1000);

    // For "create" drag from library, candidate set excludes any edges of the
    // overlay being moved (this branch is "create", so no exclusion needed).
    const filteredCandidates =
      dragInfo.mode === "move"
        ? snapCandidates.filter((c) => {
            const moving = overlays.find((o) => o.id === dragInfo.existingOverlayId);
            if (!moving || c.kind !== "edge") return true;
            return c.ms !== moving.startMs && c.ms !== moving.startMs + moving.durationMs;
          })
        : snapCandidates;

    const { snappedStartMs } = computeSnap(rawStartMs, filteredCandidates, pxPerSecond, SNAP_THRESHOLD_PX);

    // Determine target track band
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

    // Resolve duration (sourceDurationMs for create; existing duration for move)
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

    const valid =
      pick.mode === "create" ||
      !isOverlapOnSameTrack(overlays, {
        trackIndex: pick.trackIndex,
        startMs: snappedStartMs,
        durationMs,
        idToIgnore,
      });

    setGhost({
      startMs: snappedStartMs,
      durationMs,
      trackIndex: pick.trackIndex,
      mode: pick.mode,
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
        ghost.mode === "create" ? addOverlayWithNewTrack(prev, newOverlay) : addOverlay(prev, newOverlay),
      );
      setSelectedOverlayId(newOverlay.id);
    }
    // move branch handled in Task F1

    setGhost(null);
  }

  if (tracks.length === 0 && !isDragging) return null;

  // Visual ghost (positioned by ghost.startMs/duration on the chosen track row)
  let ghostVisual: React.ReactNode = null;
  if (ghost && containerRef.current) {
    let ghostTop: number;
    if (ghost.mode === "create") {
      // Will sit on a brand-new top track. Show in top-zone band.
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
                onDragStart={() => {
                  /* move drag wired in Task F1 */
                }}
                onDragEnd={() => {
                  /* move drag wired in Task F1 */
                }}
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

- [ ] **Step 2: Run typecheck + manual test**

```bash
pnpm typecheck
pnpm dev
```

In browser: visit a project, ensure script + audio loaded so timeline is visible. Drag a thumbnail from library onto timeline area above TrackTags:
- A "+ New track" zone should appear at the top during drag.
- Hovering over it shows orange ghost.
- Drop creates a new overlay on a new top track.
- Click the new overlay → it gets selected (purple ring).

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/overlay-tracks.tsx
git commit -m "feat(overlay): drop from library creates overlay with snap + collision"
```

---

## Phase F — Drag-to-move existing overlay

### Task F1: Wire move drag through OverlayClipBlock

**Files:**
- Modify: `src/components/editor/overlay/overlay-tracks.tsx`

- [ ] **Step 1: Add move handlers**

In the existing `OverlayTracks` file, modify the `OverlayClipBlock` instances:

Get drag context handles:

```ts
const { startDrag, endDrag } = useOverlayDrag();
```

Replace the `onDragStart`/`onDragEnd` props passed to each `<OverlayClipBlock>`:

```tsx
<OverlayClipBlock
  key={o.id}
  overlay={o}
  pxPerSecond={pxPerSecond}
  selected={selectedOverlayId === o.id}
  onSelect={() => setSelectedOverlayId(o.id)}
  onDragStart={(e) => {
    e.dataTransfer.effectAllowed = "move";
    if (typeof window !== "undefined") {
      const img = new Image();
      img.src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      e.dataTransfer.setDragImage(img, 0, 0);
    }
    startDrag({ mode: "move", existingOverlayId: o.id });
  }}
  onDragEnd={() => endDrag()}
/>
```

In `onDrop`, after the `if (dragInfo.mode === "create")` branch, add the move branch:

```ts
if (dragInfo.mode === "move") {
  const moving = overlays.find((o) => o.id === dragInfo.existingOverlayId);
  if (moving) {
    setOverlays((prev) => {
      const moved = prev.map((o) =>
        o.id === moving.id
          ? { ...o, startMs: ghost.startMs, trackIndex: ghost.trackIndex }
          : o,
      );
      // compact tracks to remove gaps left by source track becoming empty
      const usedIndices = Array.from(new Set(moved.map((o) => o.trackIndex))).sort((a, b) => a - b);
      const remap = new Map<number, number>();
      usedIndices.forEach((idx, newIdx) => remap.set(idx, newIdx));
      return moved.map((o) => ({ ...o, trackIndex: remap.get(o.trackIndex) ?? o.trackIndex }));
    });
  }
}
```

(Or import `compactTracks` from `overlay-store` and use it directly.)

Refactor to use `compactTracks`:

```ts
import { addOverlay, addOverlayWithNewTrack, moveOverlay, compactTracks } from "@/lib/overlay/overlay-store";

// in onDrop:
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
```

- [ ] **Step 2: Run typecheck + manual test**

```bash
pnpm typecheck
pnpm dev
```

Test:
- Drop one overlay from library.
- Click + drag the overlay sideways within its track → should move; snap to playhead/section/zero.
- Drag overlap onto another overlay same track → red ghost, drop rejected.
- Drag up to top zone → creates new top track, original track gets compacted away.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/overlay-tracks.tsx
git commit -m "feat(overlay): drag-to-move existing overlay with collision + compact"
```

---

## Phase G — Edit ops: select / split / delete

### Task G1: Click track row deselects overlay + seeks playhead

**Files:**
- Modify: `src/components/editor/overlay/overlay-tracks.tsx`

- [ ] **Step 1: Add click handler on track rows**

Pull `playerSeekRef` from BuildState in `OverlayTracks`:

```ts
const { ..., playerSeekRef } = useBuildState();
```

On the outer container (`<div ref={containerRef} ...>`) add:

```tsx
onClick={(e) => {
  // Ignore clicks that originated on a clip block (their own onClick handles selection)
  const target = e.target as HTMLElement;
  if (target.closest("[data-overlay-block]")) return;
  setSelectedOverlayId(null);
  const rect = containerRef.current!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ms = Math.max(0, (x / pxPerSecond) * 1000);
  playerSeekRef.current?.(ms);
}}
```

- [ ] **Step 2: Manual test**

Click empty area of overlay track → playhead jumps + selected overlay deselects (purple ring removed).

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/overlay-tracks.tsx
git commit -m "feat(overlay): click empty track row deselects + seeks playhead"
```

---

### Task G2: Split-at-playhead button + `C` keyboard shortcut

**Files:**
- Modify: `src/components/editor/timeline/timeline-panel.tsx`
- Create: `src/components/editor/overlay/use-overlay-keyboard.ts`

- [ ] **Step 1: Create keyboard hook**

```ts
// src/components/editor/overlay/use-overlay-keyboard.ts
"use client";

import { useEffect } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { splitOverlayAtMs, removeOverlay, compactTracks } from "@/lib/overlay/overlay-store";

export function useOverlayKeyboard() {
  const {
    overlays,
    setOverlays,
    selectedOverlayId,
    setSelectedOverlayId,
    playheadMs,
  } = useBuildState();

  useEffect(() => {
    function isInTextField(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isInTextField(e.target)) return;
      if (!selectedOverlayId) return;

      if (e.code === "KeyC" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOverlays((prev) => splitOverlayAtMs(prev, selectedOverlayId, playheadMs));
        return;
      }
      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        setOverlays((prev) => compactTracks(removeOverlay(prev, selectedOverlayId)));
        setSelectedOverlayId(null);
        return;
      }
      if (e.code === "Escape") {
        setSelectedOverlayId(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlays, selectedOverlayId, setOverlays, setSelectedOverlayId, playheadMs]);
}
```

- [ ] **Step 2: Mount the hook**

In `OverlayTracks` (the container), call the hook at the top:

```ts
import { useOverlayKeyboard } from "./use-overlay-keyboard";

export function OverlayTracks({ pxPerSecond }: OverlayTracksProps) {
  useOverlayKeyboard();
  // ...rest
}
```

- [ ] **Step 3: Add Split button in timeline header**

Modify `src/components/editor/timeline/timeline-panel.tsx`. Add import at top:

```ts
import { Scissors } from "lucide-react";
import { splitOverlayAtMs } from "@/lib/overlay/overlay-store";
```

Pull more from BuildState:

```ts
const {
  ...,
  overlays,
  setOverlays,
  selectedOverlayId,
} = useBuildState();
```

Compute `canSplit`:

```ts
const canSplit = useMemo(() => {
  if (!selectedOverlayId) return false;
  const o = overlays.find((x) => x.id === selectedOverlayId);
  if (!o) return false;
  const localMs = playheadMs - o.startMs;
  return localMs > 0 && localMs < o.durationMs;
}, [overlays, selectedOverlayId, playheadMs]);
```

Add a Split button next to the existing zoom buttons in the header bar:

```tsx
<button
  type="button"
  disabled={!canSplit}
  onClick={() => {
    if (!canSplit || !selectedOverlayId) return;
    setOverlays((prev) => splitOverlayAtMs(prev, selectedOverlayId, playheadMs));
  }}
  className="p-1 hover:bg-muted rounded disabled:opacity-30 disabled:cursor-not-allowed"
  aria-label="Split overlay at playhead"
  title="Split (C)"
>
  <Scissors className="w-3 h-3" />
</button>
```

Place it before the zoom buttons.

- [ ] **Step 4: Manual test**

Drop an overlay; select it; move playhead inside its range (click on timeline ruler); press `C` → overlay splits into two adjacent pieces. Click Split button → same. Type `c` in the script textarea → no split (text field guard works).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/overlay/use-overlay-keyboard.ts src/components/editor/overlay/overlay-tracks.tsx src/components/editor/timeline/timeline-panel.tsx
git commit -m "feat(overlay): split button + C/Delete/Esc keyboard shortcuts"
```

---

## Phase H — Inspector

### Task H1: OverlayInspector component

**Files:**
- Create: `src/components/editor/overlay/overlay-inspector.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/editor/overlay/overlay-inspector.tsx
"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { mutateOverlay, removeOverlay, compactTracks } from "@/lib/overlay/overlay-store";
import { getThumbnail } from "@/lib/clip-storage";
import { formatMs } from "@/lib/format-time";

interface OverlayInspectorProps {
  overlayId: string;
}

export function OverlayInspector({ overlayId }: OverlayInspectorProps) {
  const { overlays, setOverlays, setSelectedOverlayId } = useBuildState();
  const overlay = overlays.find((o) => o.id === overlayId) ?? null;

  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!overlay || overlay.kind !== "broll-video") return;
    let url: string | null = null;
    let active = true;
    getThumbnail(overlay.indexeddbKey).then((buf) => {
      if (!active || !buf) return;
      url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      setThumbUrl(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [overlay]);

  // Stale id guard
  useEffect(() => {
    if (overlay === null) setSelectedOverlayId(null);
  }, [overlay, setSelectedOverlayId]);

  if (!overlay) return null;

  function onPatch(patch: Partial<typeof overlay>) {
    if (!overlay) return;
    setOverlays((prev) => mutateOverlay(prev, overlay.id, patch));
  }

  function onDelete() {
    if (!overlay) return;
    setOverlays((prev) => compactTracks(removeOverlay(prev, overlay.id)));
    setSelectedOverlayId(null);
  }

  const volumePct = Math.round(overlay.volume * 100);

  return (
    <div className="h-full flex flex-col overflow-y-auto p-3 text-xs gap-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <div className="w-12 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0">
          {thumbUrl && <img src={thumbUrl} alt="" className="w-full h-full object-cover" />}
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">
            {overlay.kind === "broll-video" ? overlay.clipId.slice(0, 12) : overlay.kind}
          </div>
          <div className="text-muted-foreground text-[10px]">
            Source: {formatMs(overlay.sourceDurationMs)}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Volume</span>
          <span className="font-mono">{volumePct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumePct}
          disabled={overlay.muted}
          onChange={(e) => onPatch({ volume: Number(e.target.value) / 100 })}
          className="w-full"
        />
        <label className="flex items-center gap-2 mt-1">
          <input
            type="checkbox"
            checked={overlay.muted}
            onChange={(e) => onPatch({ muted: e.target.checked })}
          />
          Mute
        </label>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Fade in</span>
          <span className="font-mono">{(overlay.fadeInMs / 1000).toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0}
          max={2000}
          step={100}
          value={overlay.fadeInMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            const clamped = Math.min(v, overlay.durationMs - overlay.fadeOutMs);
            onPatch({ fadeInMs: Math.max(0, clamped) });
          }}
          className="w-full"
        />
        <div className="flex justify-between">
          <span>Fade out</span>
          <span className="font-mono">{(overlay.fadeOutMs / 1000).toFixed(1)}s</span>
        </div>
        <input
          type="range"
          min={0}
          max={2000}
          step={100}
          value={overlay.fadeOutMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            const clamped = Math.min(v, overlay.durationMs - overlay.fadeInMs);
            onPatch({ fadeOutMs: Math.max(0, clamped) });
          }}
          className="w-full"
        />
      </div>

      <div className="space-y-0.5 pt-2 border-t border-border text-muted-foreground">
        <div className="flex justify-between">
          <span>Start</span>
          <span className="font-mono">{formatMs(overlay.startMs)}</span>
        </div>
        <div className="flex justify-between">
          <span>Duration</span>
          <span className="font-mono">{formatMs(overlay.durationMs)}</span>
        </div>
        <div className="flex justify-between">
          <span>Track</span>
          <span className="font-mono">V{overlay.trackIndex}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto w-full flex items-center justify-center gap-1 py-1.5 text-red-400 hover:bg-red-500/10 rounded border border-red-500/30"
      >
        <Trash2 className="w-3 h-3" />
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/overlay-inspector.tsx
git commit -m "feat(overlay): inspector panel with volume/mute/fade/delete"
```

---

### Task H2: Wire OverlayInspector into editor-shell

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Import + render**

Add import:

```ts
import { OverlayInspector } from "@/components/editor/overlay/overlay-inspector";
```

Pull `inspectorMode` and `selectedOverlayId` from BuildState:

```ts
const {
  ...,
  inspectorMode,
  selectedOverlayId,
} = useBuildState();
```

Replace the `<div className="row-start-2 col-start-3 ...">Coming soon</div>` block with:

```tsx
<div className="row-start-2 col-start-3 border-l border-border overflow-hidden bg-muted/10">
  {inspectorMode === "overlay" && selectedOverlayId ? (
    <OverlayInspector overlayId={selectedOverlayId} />
  ) : (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      Coming soon
    </div>
  )}
</div>
```

- [ ] **Step 2: Manual test**

`pnpm dev` → drop an overlay; select it → inspector appears in column 3 row 2 with volume slider. Adjust volume → state updates (verify via React DevTools that overlay.volume mutates). Click Delete → overlay removed, panel returns to "Coming soon".

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/editor-shell.tsx
git commit -m "feat(overlay): wire OverlayInspector into editor-shell column 3"
```

---

## Phase I — Preview render

### Task I1: Render overlay video elements

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Add overlay video elements**

Add import:

```ts
import { useBuildState } from "@/components/build/build-state-context";
import { findActiveOverlays, findTopmostActive, computeFadedVolume } from "@/lib/overlay/overlay-render-plan";
```

Pull `overlays` from BuildState:

```ts
const {
  ...,
  overlays,
} = useBuildState();
```

Add a ref map for overlay videos:

```ts
const overlayVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
```

Inside the main preview container `<div ...>` (the bg-black box), add overlay video rendering AFTER the existing `<video ref={videoRef} />` and the preview video:

```tsx
{overlays.map((o) => (
  <video
    key={o.id}
    ref={(el) => {
      overlayVideoRefs.current.set(o.id, el);
    }}
    playsInline
    className="absolute inset-0 w-full h-full object-cover"
    style={{ zIndex: o.trackIndex + 10, display: "none" }}
  />
))}
```

These start hidden; `ensureOverlaysLoaded` will toggle visibility per frame.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "feat(overlay): render <video> element per overlay (hidden by default)"
```

---

### Task I2: Eager preload overlay clip blobs

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Extend the preload useEffect**

Find the existing useEffect that preloads main timeline clips into `clipUrlsRef` (look for the loop iterating `timeline` and calling `getClip`).

Add a parallel iteration over `overlays`:

```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const additions = new Map<string, string>();

    // Existing main-timeline preload (keep as-is)
    if (timeline) {
      for (const section of timeline) {
        for (const c of section.clips) {
          if (c.isPlaceholder) continue;
          if (clipUrlsRef.current.has(c.indexeddbKey)) continue;
          const buf = await getClip(c.indexeddbKey);
          if (cancelled || !buf) continue;
          const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
          clipUrlsRef.current.set(c.indexeddbKey, url);
          additions.set(c.indexeddbKey, url);
        }
      }
    }

    // NEW: overlay preload
    for (const o of overlays) {
      if (o.kind !== "broll-video") continue;
      if (clipUrlsRef.current.has(o.indexeddbKey)) continue;
      const buf = await getClip(o.indexeddbKey);
      if (cancelled || !buf) continue;
      const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
      clipUrlsRef.current.set(o.indexeddbKey, url);
      additions.set(o.indexeddbKey, url);
    }

    if (!cancelled && additions.size > 0) {
      setClipUrls((prev) => {
        const next = new Map(prev);
        additions.forEach((v, k) => next.set(k, v));
        return next;
      });
    }
  })();
  return () => {
    cancelled = true;
  };
}, [timeline, overlays]);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "feat(overlay): eager preload overlay clip blobs into shared clipUrlsRef"
```

---

### Task I3: ensureOverlaysLoaded + integrate with rAF and seek

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Define ensureOverlaysLoaded**

Add a useCallback near the existing `ensureClipLoaded`:

```ts
const ensureOverlaysLoaded = useCallback(
  (audioMs: number) => {
    const audio = audioRef.current;
    const audioPlaying = audio !== null && !audio.paused;

    const active = findActiveOverlays(overlays, audioMs);
    const topmost = findTopmostActive(overlays, audioMs);
    const activeIds = new Set(active.map((o) => o.id));

    for (const o of overlays) {
      const el = overlayVideoRefs.current.get(o.id);
      if (!el) continue;

      if (!activeIds.has(o.id)) {
        if (!el.paused) el.pause();
        el.style.display = "none";
        continue;
      }

      if (o.kind !== "broll-video") continue;

      const url = clipUrlsRef.current.get(o.indexeddbKey);
      if (!url) continue;
      if (el.src !== url && el.currentSrc !== url) el.src = url;

      const targetSec = (audioMs - o.startMs + o.sourceStartMs) / 1000;
      if (Math.abs(el.currentTime - targetSec) > 0.1) {
        try {
          el.currentTime = Math.max(0, targetSec);
        } catch {
          // metadata not ready yet
        }
      }

      el.volume = computeFadedVolume(o, audioMs);
      el.muted = o.muted;
      el.style.display = topmost && o.id === topmost.id ? "block" : "none";

      if (audioPlaying && el.paused) void el.play();
      else if (!audioPlaying && !el.paused) el.pause();
    }
  },
  [overlays],
);
```

- [ ] **Step 2: Integrate with rAF loop**

Find the existing `useEffect(() => { if (!isPlaying || !plan || !timeline) return; ...; tick = () => { ... ensureClipLoaded(audioMs); ... }; }, [...])`.

Inside `tick()`, call `ensureOverlaysLoaded(audioMs)` right after `ensureClipLoaded(audioMs)`:

```ts
ensureClipLoaded(audioMs);
ensureOverlaysLoaded(audioMs);
```

Also handle the case where there's no main-track plan but overlays exist: relax the early return.

Change:
```ts
if (!isPlaying || !plan || !timeline) return;
```
to:
```ts
if (!isPlaying) return;
```

(Inside the loop, `ensureClipLoaded` is already a no-op when `plan` is null.)

Add `ensureOverlaysLoaded` to the useEffect dependency array.

- [ ] **Step 3: Integrate with seek paths**

Find the `playerSeekRef.current = (ms: number) => {...}` block. After `ensureClipLoaded(ms)`, add:

```ts
ensureOverlaysLoaded(ms);
```

Find the useEffect that seeks to a section start when `selectedSectionIndex` changes. After `ensureClipLoaded(cursor)`, add:

```ts
ensureOverlaysLoaded(cursor);
```

Add `ensureOverlaysLoaded` to the dependency arrays.

- [ ] **Step 4: Run dev + manual test**

```bash
pnpm dev
```

Test:
- Drop an overlay onto an empty section spot.
- Press play — when playhead enters overlay range, the overlay video appears (covering the main video).
- Multiple overlays at same time on different tracks → only the highest trackIndex shows; you should hear ALL their audio mixed with the master voice-over.
- Toggle Mute in inspector → overlay's audio drops while video still plays.
- Drag volume slider → audio level changes in real time.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "feat(overlay): preview render — sync overlays via rAF + seek paths"
```

---

## Phase J — Documentation + cross-browser test

### Task J1: Write INDEX.md for both folders

**Files:**
- Create: `src/lib/overlay/INDEX.md`
- Create: `src/components/editor/overlay/INDEX.md`

- [ ] **Step 1: Write `src/lib/overlay/INDEX.md`**

```markdown
# Overlay feature — lib INDEX

This folder holds **pure logic** for the overlay tracks feature. UI components live under `src/components/editor/overlay/`. See the spec at `docs/superpowers/specs/2026-04-28-overlay-tracks-v1-design.md`.

## I want to fix...

| Bug / change request                                  | File                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Snap not catching the playhead                        | `overlay-snap.ts`                                       |
| Snap priority order (playhead > section > edge)        | `overlay-snap.ts` (PRIORITY map)                        |
| Allow overlap on same track                           | `overlay-collision.ts`                                  |
| Track auto-compact behavior wrong                     | `overlay-store.ts` (`compactTracks`)                    |
| Split / move logic                                    | `overlay-store.ts`                                      |
| Volume / mute / fade computation per frame            | `overlay-render-plan.ts` (`computeFadedVolume`)         |
| Topmost overlay selection                             | `overlay-render-plan.ts` (`findTopmostActive`)          |
| Drop creates new track when it shouldn't              | `overlay-tracks.ts` (`pickTrack`)                       |
| Add a new field to `OverlayItem`                      | `overlay-types.ts`, then grep usages                    |

## Data flow

```
LibraryPanel (drag source via overlay-drag-source) → overlay-drag-context
  → TimelinePanel/OverlayTracks (drop target)
    → overlay-store reducers → BuildState.overlays
      → PreviewPlayer reads overlays + computes per-frame plan via overlay-render-plan
        → overlay-tracks.tsx UI updates from BuildState
```

## Concept reference

- **OverlayItem:** discriminated-union element on a free-form track. Only `BrollVideoOverlay` is implemented in v1; `audio-fx` and `text` are reserved type names.
- **trackIndex:** integer; 0 = lowest overlay (just above main), larger = on top of the render stack.
- **sourceStartMs / sourceDurationMs:** offset and length in the original clip; non-zero `sourceStartMs` happens after a split.
- **Half-open interval:** `[startMs, startMs+durationMs)` — overlay at exact end is NOT active.

## Testing

Each module has tests under `__tests__/`. Run them with `pnpm test src/lib/overlay/`.
```

- [ ] **Step 2: Write `src/components/editor/overlay/INDEX.md`**

```markdown
# Overlay feature — UI INDEX

UI for overlay tracks. Pure logic lives under `src/lib/overlay/`. Spec: `docs/superpowers/specs/2026-04-28-overlay-tracks-v1-design.md`.

## I want to fix...

| Bug / change request                                  | File                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Drag from library not starting                       | `overlay-drag-source.ts` (and `clip-grid.tsx` wiring)      |
| Ghost preview wrong color / position                 | `overlay-tracks.tsx` (ghostVisual block)                   |
| Snap target not highlighting                         | `overlay-tracks.tsx` (extend ghostVisual to render snap line) |
| Overlay block doesn't show thumbnail                 | `overlay-clip-block.tsx`                                   |
| Inspector slider not updating preview                | `overlay-inspector.tsx` (mutateOverlay) + `preview-player.tsx` (rAF reads overlays) |
| Split button disabled state wrong                    | `timeline-panel.tsx` (`canSplit` memo)                     |
| Keyboard shortcut not firing                         | `use-overlay-keyboard.ts` (text-field guard)               |
| Drop zone not appearing                              | `overlay-tracks.tsx` (`isDragging` check + collapse rules) |

## Component tree (when an overlay is selected)

```
EditorShell
└── OverlayDragProvider                       (overlay-drag-context)
    ├── LibraryPanel
    │   └── ClipGrid
    │       └── ClipTile                      (uses useOverlayDragSource)
    ├── PreviewPlayer                         (renders <video> per overlay)
    ├── OverlayInspector                      (column 3 row 2 when overlay selected)
    └── TimelinePanel
        ├── TimelineRuler
        ├── OverlayTracks                     (mounts useOverlayKeyboard)
        │   ├── OverlayDropZone               (top zone, only during drag)
        │   ├── (per track row)
        │   │   └── OverlayClipBlock          (drag handle + select)
        │   └── ghostVisual (during drag)
        ├── TrackTags                         (existing main track)
        ├── TrackClips                        (existing main track)
        └── TrackAudio                        (existing main track)
```

## Drag state machine

`overlay-drag-context.tsx` holds the current `dragInfo`:
- `null` = idle
- `{ mode: "create", ... }` = dragging from library
- `{ mode: "move", existingOverlayId }` = dragging an existing overlay

`OverlayTracks.onDragOver` reads `dragInfo` to decide snap, target track, and ghost color.
`OverlayTracks.onDrop` mutates `BuildState.overlays` via `overlay-store` reducers.
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/overlay/INDEX.md src/components/editor/overlay/INDEX.md
git commit -m "docs(overlay): INDEX.md navigation maps for lib and UI folders"
```

---

### Task J2: Manual cross-browser smoke test

**Files:** none (testing only)

- [ ] **Step 1: Spin up dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test on Chrome (macOS)**

- Drag clip from library → drops onto top zone → new top track appears with overlay.
- Drop a second clip on the existing track → it should snap to playhead/section boundary.
- Drag clip onto same track range as another → red ghost; drop rejected.
- Press play → overlay video appears during its window; main voice-over keeps playing; **overlay audio audibly mixes with voice-over**.
- Multiple overlays simultaneously on different tracks → topmost video shows; both audios mix.
- Adjust volume slider → audio level changes in real time.
- Toggle mute → overlay audio drops, video still shows.
- Toggle fade in/out 1s → volume ramps observably.
- Press `C` with playhead inside selected overlay → splits in two.
- Press `Delete` → removes; if last on track, track collapses.
- Press `Esc` → deselects.
- Type `c` in script textarea → no split happens.

- [ ] **Step 3: Test on Safari (macOS)**

Repeat all of Step 2. Pay particular attention to:
- Audio mixing across multiple `<video display:none>` elements (Safari is the most likely to fail here).
- Drag-and-drop event firing reliability.
- If any audio drops out, document which condition reproduces it; create a follow-up issue.

- [ ] **Step 4: Test on Firefox (macOS)**

Same as Step 2/3. Note any divergent behavior.

- [ ] **Step 5: Document findings**

If everything passes, no further action. If a browser breaks, capture the failure mode in a comment in `src/components/editor/overlay/INDEX.md` under a new section "Known browser issues".

- [ ] **Step 6: Final commit (if INDEX updated)**

```bash
git add src/components/editor/overlay/INDEX.md
git commit -m "docs(overlay): note browser compatibility findings"
```

(Skip if no findings to document.)

---

## Done — v1 ship checklist

After all phases above, verify against the spec's done-checklist (`docs/superpowers/specs/2026-04-28-overlay-tracks-v1-design.md` § "v1 done-checklist (final)"). Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

All green → branch is ready for merge / PR.

**What's NOT in v1 (intentional — see spec):**
- Export integration (overlays absent from rendered MP4) — v1.5
- Persistence across reload — v1.6
- Undo / duplicate / multi-select — v2+
- Drag-edge handles for speed — v2
- Audio FX overlay — v2.5
- Text overlay — v3
- Volume above 100% — v3.5+

The Export dialog should display a message: "Overlay clips are not included in the rendered file yet (coming in v1.5)". This is a tiny addition to `export-dialog.tsx` and can be added as a final cleanup commit if not already obvious to the user.

---

## Self-review against spec — verified

- [x] **Spec coverage:**
  - Section "Architecture & data model" → Tasks A1, B1.
  - Section "File structure" → Tasks A1–A6, C1, C2, D1–D4, J1.
  - Section "UI / Layout" → Tasks D3, D4, H2.
  - Section "Drag-drop mechanics" → Tasks C1, C2, E1, F1.
  - Section "Preview render pipeline" → Tasks I1, I2, I3.
  - Section "Inspector panel" → Tasks H1, H2.
  - Section "Edit operations" → Tasks G1, G2.
  - Section "v1 done-checklist" → final ship checklist above.

- [x] **Type consistency:** `OverlayItem`, `BrollVideoOverlay`, `DragInfo`, `SnapCandidate`, `TrackBand`, `PickResult`, `CollisionTarget`, `GhostState` are defined once and used consistently across tasks.

- [x] **Method signatures match across tasks:** `mutateOverlay`, `compactTracks`, `removeOverlay`, `splitOverlayAtMs`, `moveOverlay`, `addOverlay`, `addOverlayWithNewTrack` all defined in Task A2 and reused by name throughout E1, F1, G2, H1.

- [x] **No placeholders:** every step contains either runnable code, exact commands, or a manual-verification checklist with concrete observations.

- [x] **Frequent commits:** 22 commits across the plan, each scoped to one logical unit.
