# Overlay Tracks v1 (b-roll-only) — Design

**Status:** Approved (brainstorm complete)
**Date:** 2026-04-28
**Branch:** likely a fresh branch from `feat/srt-style-script-format`
**Predecessor:** [`2026-04-26-capcut-editor-design.md`](./2026-04-26-capcut-editor-design.md) — established the section-based main timeline this feature stacks on top of.

---

## Problem

The current timeline is **section-locked**: clips are auto-matched into script-driven sections, each with a fixed slot. There is no way to add a clip that overrides what the section assigned, or to layer multiple clips at the same point in time. The user wants CapCut-style **overlay tracks** — drag a b-roll clip from the library onto a track above the main timeline so that during the clip's window, its video covers the main track. This is the foundation for future overlay types (audio FX, text, effects), all of which will reuse the same timeline + drag-drop + render plumbing.

## Goal

Ship **v1**: drag-and-drop b-roll video overlays onto dynamic tracks above the existing main track, with click-select / move / split / delete and an inspector panel for volume / fade / mute. Live preview only — export, persistence, and other overlay kinds (audio FX, text) come in later phases. Architect the data model so v2/v3 features are pure additions, not rewrites.

## Non-goals (v1)

- **Export integration.** `render-worker.ts` keeps current section-based concat behavior. Overlays are visible in preview only. Export dialog will show a hint that overlays aren't included yet.
- **Persistence.** Overlay state stays in-memory, same as the existing audio/script/timeline state. Reload loses overlays.
- **Other overlay kinds.** No mp3/SFX, no text overlays, no stickers, no effects, no transitions in v1. The data model defines a discriminated union to keep them additive later.
- **Speed control.** No drag-edge handles in v1; user achieves trim via split + delete. (When drag-edges arrive in v2, they will control speed, not trim.)
- **Undo/redo.** No `Cmd+Z` in v1 — destructive ops (delete, split, drag-move) are immediate. v2 adds a command stack.
- **Multi-select / duplicate / cut-paste.**
- **Color/filter, scale/position (PIP), rotation, blend modes.** Overlay always full-replaces the main track during its active window.
- **Volume above 100%.** HTMLMediaElement only goes to 1.0; v2 adds Web Audio GainNode for 0–200%.
- **Right-click context menu.**
- **Auto-duck main audio when overlay plays.** Overlay's audio mixes flat with main audio (see Decision 4).
- **DB schema changes.** No new tables, no migrations. The DB-vs-local strategic decision is deferred to v1.5 planning (see "Long-term direction").

## Core decisions (from brainstorm)

| #   | Decision                                                                                            | Reason                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **v1 scope = b-roll video overlay only**, with `OverlayItem` as discriminated union ready for `audio-fx` and `text` later | User: "validate cái core work, sau có thêm cái j nữa thì rất dễ." Generic data model + render switch keeps v2/v3 as additions, not rewrites. |
| 2   | **Dynamic tracks (CapCut-style)** — drop into top zone auto-creates a new track; deleting last clip on a track auto-compacts | User explicitly asked to mimic CapCut, not Filmora's fixed-track model.                                                                                                                         |
| 3   | **Top of UI = highest layer.** trackIndex 0 sits just above main; larger trackIndex renders on top.  | Matches user intuition with CapCut + matches CSS z-index direction (visual stack = render stack).                                                                                                |
| 4   | **Audio mixes flat by default** — overlay clip's audio plays alongside main voice-over. `muted: false` default. | User: "audio broll và main hoạt động như bình thường, còn việc giảm âm lượng broll hay không, chúng ta có thể build 1 function sau đc." Ducking deferred to v3.5+.                              |
| 5   | **Hybrid snap on drop / move:** free position with magnetic snap (≤10px) to playhead, section boundaries, and clip edges; priority playhead > section > edge > zero. | CapCut feel without forced grid. ~150 LOC of snap logic.                                                                                                                                       |
| 6   | **Same-track overlap is rejected** (visual feedback only, no toast). Drop into different track or top-zone for new track instead. | User picked reject over push-right or auto-create. Matches CapCut's "can't overlap" behavior on a single track.                                                                                |
| 7   | **Timeline extends past audio duration** when overlay drops past it. The portion past audio doesn't play (audio is time master) but is visible on the timeline. | Doesn't lock the user; export-phase work can fill the gap with silence or SFX later.                                                                                                            |
| 8   | **Trim via split + delete** (not drag-edge handles). Split-at-playhead button on toolbar + `C` shortcut. | User: drag-edge handles are confusing for trim and would conflict with v2's speed control. CapCut's true trim model is split-into-pieces.                                                       |
| 9   | **Preview-only in v1; export integration is a separate v1.5 phase.**                                | Render-worker rewrite (filter\_complex graph) is high-risk and tangential to validating UX. User: "validate cái core work."                                                                     |
| 10  | **In-memory state only.** No DB schema changes. Persistence + DB-vs-local direction deferred to v1.5. | Adding partial persistence (only overlays) while audio/script remain in-memory creates a confusing UX. Either persist everything or nothing; that's a v1.5 design decision.                     |
| 11  | **Native HTML5 drag-and-drop API** (no `react-dnd`/`dnd-kit`).                                      | One drag source, one drop target — native is enough. Avoids new dependency.                                                                                                                     |
| 12  | **One `<video>` element per overlay**, kept in DOM, src lazy-set on first activation, eager blob URL preload via existing `clipUrlsRef`. | Browser natively mixes audio from multiple simultaneous video elements. Pre-create avoids element churn during scrub. Memory pessimism (~10MB × N) is acceptable for VSL workloads (N ≪ 50).   |

---

## Architecture

### Two parallel timelines, rendered together

The main track stays section-based (`timeline: MatchedSection[]`). Overlay state is parallel and free-form:

```ts
overlays: OverlayItem[];   // free-form clips on dynamic tracks above main
```

The two arrays are independent in data but composed in the preview render path. Auto-match logic does not change.

### `OverlayItem` — discriminated union (extensible)

```ts
// src/lib/overlay/overlay-types.ts

export type OverlayKind = "broll-video" | "audio-fx" | "text"; // v1 only implements "broll-video"

interface OverlayBase {
  id: string;            // crypto.randomUUID()
  kind: OverlayKind;
  trackIndex: number;    // 0 = lowest (just above main), N = highest (on top)
  startMs: number;       // absolute time on the timeline
  durationMs: number;    // length on the timeline (after trim/split)
  volume: number;        // 0..1.0 in v1 (0..2.0 in v2 via Web Audio)
  muted: boolean;        // default false
  fadeInMs: number;      // default 0
  fadeOutMs: number;     // default 0
}

export interface BrollVideoOverlay extends OverlayBase {
  kind: "broll-video";
  clipId: string;            // FK -> clips table (metadata reference)
  indexeddbKey: string;      // direct blob lookup, avoids DB hit during render
  sourceStartMs: number;     // offset into the source clip (default 0; non-zero after split)
  sourceDurationMs: number;  // total source clip duration (immutable, for clamping)
}

// Future, defined here so the render switch is exhaustive from day 1:
// export interface AudioFxOverlay extends OverlayBase { kind: "audio-fx"; ... }
// export interface TextOverlay   extends OverlayBase { kind: "text";      ... }

export type OverlayItem = BrollVideoOverlay; // | AudioFxOverlay | TextOverlay
```

### `BuildState` extension

Four new fields in `src/components/build/build-state-context.tsx`:

```ts
overlays: OverlayItem[];
setOverlays: (next: OverlayItem[] | ((prev: OverlayItem[]) => OverlayItem[])) => void;
selectedOverlayId: string | null;
setSelectedOverlayId: (id: string | null) => void;
```

Derived `inspectorMode` becomes `"section" | "overlay" | "empty"`. Selecting an overlay clears `selectedSectionIndex` and vice versa.

`totalMs` derivation extends to:

```ts
totalMs = max(
  audioDurationMs,
  sumOf(timeline.map(s => s.durationMs)),
  maxOf(overlays.map(o => o.startMs + o.durationMs))
)
```

### `clipUrlsRef` shared

Existing `clipUrlsRef` (a `Map<indexeddbKey, blobUrl>`) is reused. Overlay clips and main track clips that point at the same source share a single blob URL — no double memory.

---

## File structure

All new code lives under two feature folders. Each has an `INDEX.md` that serves as a navigation map for future maintainers.

### Logic / pure functions / types

```
src/lib/overlay/
├── INDEX.md                    ← read first when fixing this feature
├── overlay-types.ts            ← OverlayItem, OverlayKind, BrollVideoOverlay
├── overlay-store.ts            ← reducers: addOverlay, addOverlayWithNewTrack,
│                                  removeOverlay, moveOverlay, splitOverlayAtMs,
│                                  mutateOverlay, compactTracks
├── overlay-snap.ts             ← magnetic snap (10px to playhead/section/edges)
├── overlay-collision.ts        ← same-track overlap detection
├── overlay-tracks.ts           ← dynamic track lifecycle: create/destroy/compact
├── overlay-render-plan.ts      ← per-frame plan: which overlays active at ms,
│                                  topmost for visibility, audio mix list, faded volume
└── __tests__/                  ← unit tests for each module above
```

### UI / React components

```
src/components/editor/overlay/
├── INDEX.md                    ← read first
├── overlay-tracks.tsx          ← N dynamic track rows on the timeline
├── overlay-clip-block.tsx      ← one clip block (select / drag-thân-to-move)
├── overlay-drop-zone.tsx       ← drop target visual; ghost preview during drag
├── overlay-drag-source.ts      ← hook attached to library thumbnails
├── overlay-drag-context.tsx    ← React context for drag state
└── overlay-inspector.tsx       ← right-column panel when an overlay is selected
```

### `INDEX.md` format (mandatory contract)

Each `INDEX.md` is markdown (not a TS re-export). Format:

```markdown
# Overlay feature — <lib|UI> INDEX

## I want to fix...

| Bug / change request                       | File                                       |
| ------------------------------------------ | ------------------------------------------ |
| Snap not catching the playhead             | overlay-snap.ts                            |
| Allow overlap on same track                | overlay-collision.ts                       |
| Volume slider doesn't update preview audio | overlay-render-plan.ts + preview-player    |
| Add a new field to OverlayItem             | overlay-types.ts (then grep usages)        |

## Data flow
LibraryPanel (drag source) → overlay-drag-context → TimelinePanel (drop target)
  → overlay-store.addOverlay() → BuildState.overlays
  → PreviewPlayer reads overlays + builds render plan via overlay-render-plan.ts
  → overlay-tracks.tsx renders timeline UI

## Concept reference
- OverlayItem: free-form clip on a track above main track section-based clips
- trackIndex: 0 = just above main, larger = on top (z-index)
```

**Rule:** any PR that adds/renames/removes a file in these folders must also update the corresponding `INDEX.md`. CI lint is out of scope; trust the reviewer.

### Existing files touched (only 4)

| File                                                          | Change                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/components/build/build-state-context.tsx`                | Add `overlays`, `setOverlays`, `selectedOverlayId`, `setSelectedOverlayId`; extend `inspectorMode`; extend `totalMs` derivation |
| `src/components/editor/timeline/timeline-panel.tsx`           | Render `<OverlayTracks />` above `<TrackTags />`; add Split button; update `totalMs` calc       |
| `src/components/editor/preview/preview-player.tsx`            | Render N `<video>` overlay elements; extend rAF loop with `ensureOverlaysLoaded`; extend seek/scrub paths |
| `src/components/editor/editor-shell.tsx`                      | Render `<OverlayInspector />` in column 3 row 2 when `inspectorMode === "overlay"`              |

Everything else (logic, helpers, drag/drop infra, inspector UI) lives in the two new folders. Nothing scattered.

---

## UI / Layout

### Timeline stack (top → bottom)

```
┌─────────────────────────────────────────────────────────┐
│ Header: play/pause · time · split (✂) · zoom            │
├─────────────────────────────────────────────────────────┤
│ Ruler                                                   │
├─────────────────────────────────────────────────────────┤
│ ╔═ DROP ZONE (only during drag): "+ New track" ════════╗│  ← drop here = create new top track
│ Track V_N (highest trackIndex; renders on top)          │
│ Track V_{N-1}                                           │
│ ...                                                     │
│ Track V_0 (lowest overlay; sits just above main)        │
├─────────────────────────────────────────────────────────┤  ← visual divider: overlay area / main area
│ TrackTags     (existing, unchanged)                     │
│ TrackClips    (existing, unchanged — main video)        │
│ TrackAudio    (existing, unchanged)                     │
└─────────────────────────────────────────────────────────┘
```

- Track height: **40px** (compact; main TrackClips stays 90px).
- Stack order in UI = render stack order (top of UI = top of layer).
- With **0 overlays**, the overlay area collapses to a thin "drop hint" strip that only appears during a drag.

### Track lifecycle

- **Create:** drop in top-zone → `trackIndex = max + 1`. Drop into existing track row → use that track's index.
- **Destroy:** when an action leaves a track with 0 clips → `compactTracks(overlays)` removes the empty index and shifts higher tracks down by 1.
- **Drop into empty space between tracks:** snaps to nearest track row (no gaps allowed mid-stack).

### Editor-shell wiring

```tsx
// editor-shell.tsx column 3 row 2 (currently "Coming soon")
{inspectorMode === "overlay" && selectedOverlayId
  ? <OverlayInspector overlayId={selectedOverlayId} />
  : inspectorMode === "section"
    ? <SectionInspector />          // existing path
    : <ComingSoonPlaceholder />}
```

Future v2.5+ may expand this column into a tabbed panel (Overlay / Effects / Text / Audio Mix).

---

## Drag-drop mechanics

### State machine

```
IDLE
  │ mousedown on library thumbnail (or overlay clip body)
  ▼
PRESSED (waiting for >5px movement to disambiguate from click)
  │ moved >5px
  ▼
DRAGGING (overlay-drag-context active; ghost visible)
  │ over timeline → compute snap + pickTrack → ghost tracks cursor
  │ leave timeline area → ghost hides; drop blocked
  │ drop in valid zone   drop outside / Esc
  ▼                       ▼
COMMIT                   CANCEL (no-op; original state intact)
```

### Drag payload (`DragInfo`)

```ts
type DragInfo =
  | {
      mode: "create";              // dragging from library
      kind: "broll-video";
      clipId: string;
      indexeddbKey: string;
      sourceDurationMs: number;
      thumbnailUrl: string;
      ghostWidthPx: number;        // = sourceDurationMs * pxPerSec
    }
  | {
      mode: "move";                // dragging an existing overlay
      existingOverlayId: string;
      // snap excludes this overlay's own edges; collision check excludes self
    };
```

### Snap (`overlay-snap.ts`)

On `dragOver`:

1. `rawStartMs = (mouseX - timelineLeft) / pxPerSec`
2. Collect candidates: `playheadMs`, all section start/end, all overlay edges (excluding self for move), `0`.
3. Pick the candidate within ≤10px (in pixel space, not ms). On ties, priority is **playhead > section boundary > clip edge > zero**.
4. Render a vertical orange line at the active snap target so the user sees what they're snapping to.

Returns `{ snappedStartMs, snapTarget: "playhead" | "section" | "edge" | "zero" | null }`.

### Track choice (`overlay-tracks.ts`)

```ts
function pickTrack(mouseY: number, existingTracks: TrackInfo[]): { mode: "create" | "into"; trackIndex: number } {
  if (mouseY in topDropZoneBand)             return { mode: "create", trackIndex: maxTrackIndex + 1 };
  for (const t of existingTracks)
    if (mouseY in t.rowBand)                 return { mode: "into",   trackIndex: t.trackIndex };
  return                                      { mode: "create", trackIndex: 0 }; // empty timeline edge
}
```

### Collision (`overlay-collision.ts`)

```ts
function isOverlapOnSameTrack(
  overlays: OverlayItem[],
  target: { trackIndex: number; startMs: number; durationMs: number; idToIgnore?: string }
): boolean {
  const same = overlays.filter(o => o.trackIndex === target.trackIndex && o.id !== target.idToIgnore);
  for (const o of same) {
    const oEnd = o.startMs + o.durationMs;
    const tEnd = target.startMs + target.durationMs;
    if (target.startMs < oEnd && tEnd > o.startMs) return true;
  }
  return false;
}
```

If `mode === "create"` (new track): can never overlap. If `mode === "into"`: collision means **drop is rejected** with red ghost border + `cursor: not-allowed`. No toast.

### Ghost preview

A single ghost element rendered inside `overlay-tracks.tsx` while dragging:
- Position: `left = snappedStartMs * pxPerSec`, top = mid-target-track row.
- Width: `ghostWidthPx`.
- Background: `thumbnailUrl` at 60% opacity.
- Border: cyan (valid into existing track) / orange (will create new track) / red (overlap rejected).

Browser-native ghost is suppressed via `e.dataTransfer.setDragImage(emptyImg, 0, 0)`.

### Drop commit

```ts
function handleDrop(e: React.DragEvent) {
  e.preventDefault();
  const info = ctx.dragInfo;
  if (!info) return;
  const { snappedStartMs } = computeSnap(e.clientX, ...);
  const { mode, trackIndex } = pickTrack(e.clientY, currentTracks);

  if (info.mode === "create") {
    const newOverlay: BrollVideoOverlay = {
      id: crypto.randomUUID(),
      kind: "broll-video",
      trackIndex,
      startMs: snappedStartMs,
      durationMs: info.sourceDurationMs,
      sourceStartMs: 0,
      sourceDurationMs: info.sourceDurationMs,
      clipId: info.clipId,
      indexeddbKey: info.indexeddbKey,
      volume: 1.0,
      muted: false,
      fadeInMs: 0,
      fadeOutMs: 0,
    };

    if (mode === "create") {
      setOverlays(prev => addOverlayWithNewTrack(prev, newOverlay)); // shifts existing tracks ≥ trackIndex up by 1
    } else {
      if (isOverlapOnSameTrack(overlays, { ...newOverlay })) return; // silent reject
      setOverlays(prev => [...prev, newOverlay]);
    }
    setSelectedOverlayId(newOverlay.id);
  } else {
    // info.mode === "move"
    const existing = overlays.find(o => o.id === info.existingOverlayId);
    if (!existing) return;
    const target = {
      trackIndex,
      startMs: snappedStartMs,
      durationMs: existing.durationMs,
      idToIgnore: info.existingOverlayId,
    };
    if (mode === "into" && isOverlapOnSameTrack(overlays, target)) return;
    setOverlays(prev =>
      compactTracks(moveOverlay(prev, info.existingOverlayId, { trackIndex, startMs: snappedStartMs }))
    );
  }
  ctx.endDrag();
}
```

### Library drag source

`overlay-drag-source.ts` exports `useOverlayDragSource(clip)` — a hook applied to clip thumbnails in `clip-grid.tsx`. It attaches:
- `draggable={true}`
- `onDragStart`: sets drag-context with clip metadata + thumbnail URL; calls `setDragImage(emptyImg)` to suppress native ghost.
- 5px threshold so the existing click-to-preview flow isn't broken — clicks under 5px movement still preview the clip.

---

## Preview render pipeline (v1)

### Existing model (recap, unchanged)

`PreviewPlayer` keeps:
- A master `<audio>` element — the **time master** driving everything via `audio.currentTime`.
- A single main `<video>` element with `src` swapped imperatively by `findClipAtMs(plan)` based on `audioMs`.
- A `requestAnimationFrame` loop reading `audio.currentTime`, updating `playheadMs`, calling `ensureClipLoaded`, syncing `selectedSectionIndex`.

This pipeline is **not changed**. Overlay rendering is layered on top.

### Overlay layer

In the same preview container, render one `<video>` per overlay, absolute-positioned to cover the full canvas:

```tsx
{overlays.map((o) => (
  <video
    key={o.id}
    ref={(el) => { overlayVideoRefs.current.set(o.id, el); }}
    playsInline
    className="absolute inset-0 w-full h-full object-cover"
    style={{
      zIndex: o.trackIndex + 10,   // main video at z-index 0..9; overlays start at 10
      display: "none",             // toggled in ensureOverlaysLoaded
    }}
  />
))}
```

### Eager preload

Extend the existing useEffect that preloads main track clips into `clipUrlsRef`. After collecting main-track keys, iterate `overlays` and add their `indexeddbKey`s to the same map. Shared blob URLs across main + overlay = no double memory.

### rAF tick — `ensureOverlaysLoaded(audioMs)`

Called every frame after `ensureClipLoaded`. Computes:

```ts
const active = overlays.filter(o => audioMs >= o.startMs && audioMs < o.startMs + o.durationMs);
const activeIds = new Set(active.map(o => o.id));
const topmost = active.reduce<OverlayItem | null>(
  (max, o) => (!max || o.trackIndex > max.trackIndex ? o : max), null);

for (const o of overlays) {
  const el = overlayVideoRefs.current.get(o.id);
  if (!el) continue;

  if (!activeIds.has(o.id)) {
    if (!el.paused) el.pause();
    el.style.display = "none";
    continue;
  }

  // Active: ensure src + sync currentTime + volume + visibility
  const url = clipUrlsRef.current.get(o.indexeddbKey);
  if (!url) continue;
  setVideoSrcIfChanged(el, url);

  const targetSec = (audioMs - o.startMs + o.sourceStartMs) / 1000;
  if (Math.abs(el.currentTime - targetSec) > 0.1) {
    el.currentTime = Math.max(0, targetSec);
  }
  el.volume = computeFadedVolume(o, audioMs);
  el.muted = o.muted;

  // Visual: only topmost shows; others stay hidden but still play (audio mixes natively)
  el.style.display = (topmost && o.id === topmost.id) ? "block" : "none";

  if (audioRef.current && !audioRef.current.paused && el.paused) void el.play();
  else if (audioRef.current?.paused && !el.paused) el.pause();
}
```

**Critical browser behavior verified:** `<video>` with `display: none` still plays audio in Chrome and Safari. This lets multiple active overlays mix audio while only the topmost shows visually.

### Fade in/out

```ts
function computeFadedVolume(o: OverlayItem, audioMs: number): number {
  const localMs = audioMs - o.startMs;
  let factor = 1;
  if (o.fadeInMs > 0 && localMs < o.fadeInMs) {
    factor = localMs / o.fadeInMs;
  }
  const fadeOutStart = o.durationMs - o.fadeOutMs;
  if (o.fadeOutMs > 0 && localMs > fadeOutStart) {
    factor = Math.max(0, (o.durationMs - localMs) / o.fadeOutMs);
  }
  return Math.min(1, o.volume * factor); // HTMLMediaElement clamp 0..1
}
```

Inspector clamps `fadeInMs + fadeOutMs ≤ durationMs` on save.

### Seek / scrub / click section

The existing imperative seek paths (`playerSeekRef`, `selectedSectionIndex` useEffect) call `ensureClipLoaded(audioMs)` after setting `audio.currentTime`. They additionally call `ensureOverlaysLoaded(audioMs)` so overlays catch up immediately, not on the next rAF tick.

### Edge cases

- **Overlay window past audio duration:** audio is the time master; once `audio.ended` fires, the rAF loop stops. Overlays past audio's end are visible on the timeline UI but don't play in v1. Acceptable; v1.5 (export) and v2 (audio FX as time-extender) revisit.
- **Source clip blob missing** (`clipUrlsRef.current.get(...)` returns undefined): skip the overlay's render path silently. The block on the timeline still appears (with thumbnail + a "missing" tint) so the user can delete it.
- **Volume above 1.0 in data:** clamped to 1.0 in `computeFadedVolume`. v2 unblocks this with Web Audio.

### Performance

Pessimistic case (~20 simultaneous overlays) → 20 `<video>` elements pre-loaded. Modern browsers handle this fine for short VSL workloads. If we later see jank, the migration path is a track-pooled `<video>` (one per track, swap src) — but only after measurement.

---

## Inspector panel (`overlay-inspector.tsx`)

### When it appears

`editor-shell.tsx` column 3 row 2:

```tsx
{inspectorMode === "overlay" && selectedOverlayId
  ? <OverlayInspector overlayId={selectedOverlayId} />
  : inspectorMode === "section"
    ? <SectionInspector />
    : <ComingSoonPlaceholder />}
```

### Layout

```
┌──────────────────────────────────────┐
│ ┌────┐                               │
│ │thmb│ hook-03.mp4                   │
│ └────┘ 0:01.97 source                │
├──────────────────────────────────────┤
│ Volume                       [100%]  │
│ ───────●───────────────              │
│                                      │
│ ☐ Mute                               │
├──────────────────────────────────────┤
│ Fade in                      [0.0s]  │
│ ●─────────────                       │
│ Fade out                     [0.0s]  │
│ ●─────────────                       │
├──────────────────────────────────────┤
│ Position (read-only v1)              │
│ Start    00:04.500                   │
│ Duration 00:01.970                   │
│ Track    V1                          │
├──────────────────────────────────────┤
│              [Delete]                │
└──────────────────────────────────────┘
```

### Field details

- **Header:** thumbnail via `getThumbnail(indexeddbKey)`, clip name (lookup by `clipId` from cached clip list), source duration.
- **Volume slider:** range 0–100, displays as %. Mutates `overlay.volume` (0..1). Disabled when `muted = true`.
- **Mute toggle:** checkbox. Mutates `overlay.muted`.
- **Fade in/out sliders:** range 0–2000 ms, step 100ms. Mutates `overlay.fadeInMs` / `fadeOutMs`. Constraint `fadeInMs + fadeOutMs ≤ durationMs` clamped on save with subtle inline warning.
- **Position:** read-only in v1. (v2 makes Start time numerically editable.)
- **Delete:** removes the overlay; also `setSelectedOverlayId(null)` and `compactTracks(...)`.

### Mutation pattern

```ts
// in overlay-store.ts
function mutateOverlay(overlays: OverlayItem[], id: string, patch: Partial<OverlayItem>) {
  return overlays.map(o => o.id === id ? { ...o, ...patch } : o);
}

// in overlay-inspector.tsx
const handleVolumeChange = (v: number) =>
  setOverlays(prev => mutateOverlay(prev, overlayId, { volume: v / 100 }));
```

State change → re-render → next rAF tick (≤16ms) reads new value → `el.volume = ...`. No special live-sync wiring.

### Empty / stale state

If `selectedOverlayId` references an overlay that no longer exists (e.g., race condition after delete), the inspector renders `ComingSoonPlaceholder` and a `useEffect` resets `selectedOverlayId = null`.

---

## Edit operations (CapCut-style: split + delete, no drag-edge trim)

### Trim model

There are no drag-edge trim handles in v1. Trim is performed by **splitting the clip at the playhead and deleting one of the resulting pieces**.

- "Trim the start of this clip" → place playhead inside clip → split → delete the left piece.
- "Trim the end" → split → delete the right piece.
- "Cut into 3 segments and rearrange" → split twice, then drag pieces.

Drag-edge handles are reserved for v2's **speed control** (extending the right edge slows the clip down; shrinking speeds it up). This avoids overloading one gesture with two semantics.

### Split (`splitOverlayAtMs` in `overlay-store.ts`)

```ts
function splitOverlayAtMs(overlays: OverlayItem[], id: string, atMs: number): OverlayItem[] {
  const o = overlays.find(x => x.id === id);
  if (!o) return overlays;
  const localMs = atMs - o.startMs;
  if (localMs <= 0 || localMs >= o.durationMs) return overlays; // playhead outside the clip → no-op

  const left: BrollVideoOverlay = {
    ...o,
    durationMs: localMs,
  };
  const right: BrollVideoOverlay = {
    ...o,
    id: crypto.randomUUID(),
    startMs: atMs,
    durationMs: o.durationMs - localMs,
    sourceStartMs: o.sourceStartMs + localMs,
  };
  return [...overlays.filter(x => x.id !== id), left, right];
}
```

Both pieces share the same `clipId` / `indexeddbKey` → same blob URL → no extra memory.

After split, **the right piece is auto-selected** so the user can immediately split or delete further if iterating.

### Split trigger

- **Toolbar button (✂)** in `timeline-panel.tsx` header, next to play/zoom controls. Disabled when no overlay is selected or playhead is outside selected overlay.
- **Keyboard shortcut `C`** with the same Space-style guard: ignored when target is `INPUT`/`TEXTAREA`/`isContentEditable`. Otherwise calls the same handler as the button.

### Move (drag clip body)

- Mousedown on clip body → 5px threshold → enter DRAGGING with `info.mode = "move"`.
- Snap and collision rules identical to drop-from-library (Drag-drop section), but the snap candidate set excludes this clip's own edges and collision check excludes its own id.
- Drop into the same track at non-overlapping range → `setOverlays(prev => moveOverlay(prev, id, { trackIndex, startMs }))`.
- Drop into different track → cross-track move; if source track becomes empty → `compactTracks(...)`.
- Cancel via Esc / drop outside → original state preserved.

### Delete

- `Delete` / `Backspace` while an overlay is selected → remove + `setSelectedOverlayId(null)` + `compactTracks(...)`.

### Keyboard shortcuts (v1)

| Key                     | Action                                          |
| ----------------------- | ----------------------------------------------- |
| `C`                     | Split selected overlay at playhead              |
| `Delete` / `Backspace`  | Delete selected overlay                         |
| `Esc`                   | Deselect overlay; cancel active drag            |
| `Space`                 | Play/pause (existing, unchanged)                |

All shortcuts ignored when target is an input/textarea/contentEditable element (matches existing Space-handler guard).

### Edge cases

| Edge case                                                              | Behavior                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Drop ends outside timeline area (header, library, padding)             | Cancel; ghost hides; no overlay added.                                    |
| Esc during drag                                                        | Cancel; original state intact.                                            |
| Drop with `startMs < 0` (over-drag past timeline start)                | Clamp `startMs = 0`.                                                      |
| Drop past audio duration                                               | Allowed (Extend timeline); `totalMs` recomputes to include overshoot.     |
| Click empty area inside a track row                                    | Deselect overlay AND seek playhead to clicked time (CapCut behavior).     |
| Source clip deleted from library while it appears as an overlay       | Render block with red "missing" tint; user can still delete the overlay. |
| User taps Cmd+Z                                                        | No-op in v1. v2 introduces undo stack.                                    |
| Click thumbnail in library while a drag is in progress                 | 5px threshold prevents click trigger; existing click-to-preview unaffected after drop. |
| Switching products (`productId` change)                                | BuildState resets → `overlays = []`.                                      |
| Reload page                                                            | All in-memory state lost (audio, script, timeline, overlays). Same as today's UX for the rest. |
| Drag move past timeline left edge                                      | Clamp `startMs = 0`.                                                      |
| Split clip down to ≤100ms pieces                                       | Allowed (very small but valid). UI may be hard to click; acceptable for v1. |

### Selection visual

- **Selected:** 2px primary-color ring + brighter thumbnail border.
- **Hover (not selected):** subtle border lift.
- **Active drag/move:** opacity 80% + cursor `grabbing`.
- **Conflict (overlap on drag):** red border + cursor `not-allowed`.

---

## v1 done-checklist (final)

**Data**
- [ ] `OverlayItem` discriminated union (`overlay-types.ts`); only `BrollVideoOverlay` implemented.
- [ ] `BuildState` extended with overlays + selectedOverlayId; `inspectorMode` accepts `"overlay"`; `totalMs` re-derived.

**File scaffolding**
- [ ] `src/lib/overlay/` + `src/components/editor/overlay/` created with `INDEX.md` in each.
- [ ] All new logic lives in those two folders.

**UI**
- [ ] `OverlayTracks` + `OverlayClipBlock` + `OverlayDropZone` rendered above `TrackTags`.
- [ ] Track height 40px; overlay area collapses when 0 overlays except during drag (drop hint).
- [ ] Split button (✂) on timeline toolbar; disabled state correctly reflects selection + playhead.
- [ ] Library `clip-grid.tsx` thumbnails wired with `useOverlayDragSource`; click-preview still works under 5px movement.

**Drag-drop**
- [ ] Drag from library → drop on overlay area creates new overlay.
- [ ] Drag overlay body → moves overlay (within or across tracks).
- [ ] Hybrid snap (10px) to playhead / section / clip edge / zero with priority order.
- [ ] Same-track overlap rejected silently (red ghost + `not-allowed`).
- [ ] Auto-create new track on top-zone drop; auto-compact tracks when last clip removed.
- [ ] Timeline extends past audio when overlay drops past it.
- [ ] Esc / drop-outside cancels cleanly.

**Edit ops**
- [ ] Click select / Esc deselect.
- [ ] Drag move with snap + collision.
- [ ] Split at playhead via button + `C` shortcut; auto-selects right piece.
- [ ] Delete selected via `Delete` / `Backspace`; track auto-compacts when empty.
- [ ] Keyboard handlers ignore INPUT/TEXTAREA/contentEditable.

**Inspector**
- [ ] Renders in column 3 row 2 when overlay selected.
- [ ] Volume slider 0–100% (clamps `overlay.volume` to 0..1).
- [ ] Mute toggle disables volume slider while muted.
- [ ] Fade in/out sliders 0–2000ms with `fadeIn + fadeOut ≤ duration` clamp.
- [ ] Position fields read-only.
- [ ] Delete button works identically to keyboard delete.

**Render**
- [ ] One `<video>` per overlay, eager preload via `clipUrlsRef`.
- [ ] rAF loop calls `ensureOverlaysLoaded` after `ensureClipLoaded`.
- [ ] Topmost active overlay visible; others hidden but still mix audio.
- [ ] Volume + fade in/out applied each frame.
- [ ] Mute toggle respected.
- [ ] Seek / scrub / click-section paths sync overlays immediately.

**Cross-cutting**
- [ ] No DB / schema changes.
- [ ] No new npm dependencies (HTML5 native drag-drop only).
- [ ] Unit tests for `overlay-store` reducers, `overlay-snap` math, `overlay-collision` predicate, `overlay-tracks` lifecycle.

---

## Future roadmap (post-v1)

| Phase  | Scope                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.5   | **Export integration.** Refactor `render-worker.ts` to FFmpeg `filter_complex` graph: `overlay=enable='between(t,start,end)'` for video, `amix` for audio (with volume + fade). Test export ↔ preview parity. **DB-vs-local strategic decision happens here** (see below).        |
| v1.6   | **Persistence (full project state).** Save audio file ref + script + timeline + overlays together. Targeting either Postgres (`project_states` table with JSON column) or IndexedDB (object store), depending on the v1.5 decision. |
| v2     | **Speed control + drag-edge handles.** Reuse `MatchedClip.speedFactor`. Right-edge drag = slow down; left-edge = adjust source-in. Audio rate handled via Web Audio to avoid pitch artifacts. |
| v2.5   | **Audio FX overlay (mp3 SFX).** Add `kind: "audio-fx"` to the union. Render path: audio-only (waveform thumbnail like `TrackAudio`). Library extension for .mp3 import. Default `muted: false`. |
| v3     | **Text overlay.** Add `kind: "text"`. Canvas/SVG layer above the video stack in `PreviewPlayer`. Inspector: text input + font + color + animation presets. Export via FFmpeg `drawtext`. |
| v3.5+  | **QoL polish.** Undo/redo (CommandStack), right-click menus, multi-select + bulk ops, color/filter, transitions, volume >100% via Web Audio GainNode, auto-duck. |

### Long-term direction — DB vs all-local (decision deferred to v1.5)

Today the codebase is already 80% local: blob bytes live in IndexedDB; Postgres only stores metadata (products / folders / clips). The v1.5 persistence work forces a strategic decision:

- **Direction A (keep Postgres):** Sync potential, multi-device, multi-user; cost of Docker for dev, migrations, deploy complexity.
- **Direction B (all-local in IndexedDB):** Zero infra, instant first-load, simpler schema versioning, real offline-first; no built-in cross-device sync (could be added later via Replicache / CRDT layer).

Given the user's framing ("custom riêng cho sản phẩm" — personal/single-user tool), Direction B is the recommended default at v1.5 planning time. **v1 deliberately makes no DB changes** so this decision can be made cleanly with real usage data, rather than guessing now.

### Risks to monitor during v1 implementation

| Risk                                                                                              | Mitigation                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| rAF loop perf with 20+ overlays                                                                  | Benchmark early. If jank: throttle overlay sync to 30fps (main video stays 60fps).                    |
| Browser audio mixing across many `<video>` elements (Safari + Firefox specifically not yet tested) | Manual cross-browser test before v1 merge. Fallback: switch to Web Audio mixing if a browser drops audio in display:none. |
| HTML5 drag-and-drop quirks (e.g., `dragend` not firing in some Chrome versions)                  | Drag context tracks state defensively; document.mouseup fallback to clear DRAGGING state.             |

### Open question deferred to implementation

Click on a track row's empty area: in CapCut this both **deselects the overlay** AND **seeks the playhead** to the clicked time. The plan locks in this behavior; if it feels wrong during testing, peel apart with a modifier (e.g., Alt-click = seek-only).
