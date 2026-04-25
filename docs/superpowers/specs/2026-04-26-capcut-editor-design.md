# CapCut-style Unified Editor — Design

**Status:** Approved (brainstorm complete)
**Date:** 2026-04-26
**Branch:** `feat/srt-style-script-format` (continuing) → likely a fresh branch for this rewrite

## Problem

The current product splits work across two tabs: a **Library** tab (`/dashboard/[productId]`) for managing b-roll clips, and a **Build Video** tab (`/dashboard/[productId]/build`) with a 4-step wizard (audio upload → script paste → timeline review → render). The user reports the UI is hard to use across many points; the keystone pain is **no live preview while editing** — the only way to see the result is to render. Tab-switching also breaks editing flow, the wizard feels like a checklist instead of a workspace, and audio/script feel disconnected from the timeline they drive.

## Goal

Replace the two tabs with a single **CapCut-style editor page** that combines library, live preview, and timeline editing into one workspace. Preserve the existing mix-and-match b-roll logic and the existing render/export pipeline. Ship a usable v1 first; layer advanced features later.

## Non-goals (v1)

- Free-form timeline (drag clips anywhere). Timeline stays section-locked, driven by parsed script.
- Continuous playback across sections (designed-for in the data model, not built).
- Drag-from-library, clip trim handles, drag-to-reorder sections.
- Cross-section timeline scrubbing.
- Persistence of editor state to IndexedDB on refresh.
- Captions track, multi-audio, AI smart-suggestions panel.
- Keyboard shortcuts beyond what's incidental.
- Mobile/responsive — desktop only.

## Core decisions

| # | Decision | Reason |
|---|---|---|
| 1 | **4-panel layout**: Library (left) · Preview (center) · Inspector (right, always-open) · Timeline (bottom, full-width) | User picked this over 3-panel-with-modal and collapsible-inspector. Inspector always-open keeps preview + edit visible together (CapCut-faithful). |
| 2 | **Per-section preview for v1, designed for continuous playback in v2** | Solves the keystone pain without multi-week multi-clip orchestration. `PlaybackPlan` shape supports continuous playback so v2 doesn't redesign the player. |
| 3 | **Setup via top toolbar pills**: 🎵 Audio and 📝 Script as status pills that open dialogs | Audio + script are project-level config that don't change often. Toolbar keeps the inspector free for the active section. |
| 4 | **3-track timeline**: tags · clips · audio | Mirrors CapCut's text/video/audio pattern; click a tag or clip block to select that section. |
| 5 | **Re-pasting script preserves locks best-effort** | Match by `tag` + duration ±20%, greedy left-to-right. Toast shows count preserved/dropped + 30s Undo. Avoids destroying manual work for trivial script edits. |
| 6 | **Refactor in place** at `/dashboard/[productId]/page.tsx`; delete `/build` route | Solo project, working logic to preserve. Reuse existing components (`FolderSidebar`, `ClipGrid`, chain/variant/preview pieces, `AudioUpload`, `ScriptPaste`, `RenderTrigger`). |

## Architecture

### Routing & file structure

```
src/app/dashboard/[productId]/
  layout.tsx          ← drop the tab strip; keep BuildStateProvider
  page.tsx            ← becomes the editor (replaces today's library)
  build/page.tsx      ← DELETED
src/components/editor/
  editor-shell.tsx    ← 4-panel grid + top toolbar
  toolbar/
    audio-pill.tsx    ← opens AudioDialog
    script-pill.tsx   ← opens ScriptDialog
    export-button.tsx ← reuses RenderTrigger logic
  library/
    library-panel.tsx ← wraps FolderSidebar + ClipGrid (sidebar icon-only by default)
  preview/
    preview-player.tsx← v1: single <video>+<audio>, per-section playback; PlaybackPlan API
  timeline/
    timeline-panel.tsx
    timeline-ruler.tsx
    track-tags.tsx
    track-clips.tsx
    track-audio.tsx   ← waveform via WebAudio peaks (canvas)
  inspector/
    inspector-panel.tsx ← hosts section editor or empty state
src/components/build/
  section-editor/
    chain-strip.tsx        ← reused inside inspector
    variant-grid.tsx       ← reused inside inspector
    preview-pane.tsx       ← reused inside inspector (mini preview)
    section-editor-dialog.tsx ← DELETED (body moves into inspector-panel)
  audio-upload.tsx    ← reused inside AudioDialog
  script-paste.tsx    ← reused inside ScriptDialog
  timeline-preview.tsx ← DELETED (replaced by inspector + timeline-panel)
src/lib/
  lock-preserve.ts    ← NEW: pure diff for re-paste lock preservation
```

### Page shell — CSS grid

```
┌─ Toolbar (h: 48px) ─────────────────────────────────────────┐
│  ← Back   ProductName   🎵 Audio  📝 Script   [▶ Export]   │
├─────────┬───────────────────────────┬──────────────────────┤
│         │                           │                      │
│ Library │      Preview              │     Inspector        │
│ (320px, │     (flex-1, 9:16         │       (360px)        │
│  may    │     box centered,         │                      │
│  grow   │     editor bg around)     │                      │
│ to 360) │                           │                      │
├─────────┴───────────────────────────┴──────────────────────┤
│                  Timeline (h: 220px)                        │
└─────────────────────────────────────────────────────────────┘
```

Grid template (logical): `auto / 320px 1fr 360px / auto 1fr 220px`. Three middle columns scroll independently. Timeline spans full width.

### State (extends today's `BuildStateProvider`)

```ts
interface EditorState {
  // existing
  audioFile: File | null;
  audioDuration: number | null;
  scriptText: string;
  sections: ParsedSection[] | null;
  timeline: MatchedSection[] | null;
  setAudio, setScriptText, onParsed, setTimeline, clearParsed;

  // new
  selectedSectionIndex: number | null;   // drives inspector + preview
  setSelectedSectionIndex: (i: number | null) => void;
  playheadMs: number;                    // current preview position
  setPlayheadMs: (ms: number) => void;
  audioDialogOpen: boolean;
  scriptDialogOpen: boolean;
  exportDialogOpen: boolean;
  setAudioDialogOpen, setScriptDialogOpen, setExportDialogOpen;

  // derived (computed in selector hooks):
  // - inspectorMode: 'section' | 'empty'
  // - canExport: boolean (audio + timeline + zero placeholders for required tags)
}
```

**Persistence:** ephemeral (React state). Refresh = lose timeline edits. Same as today.

## Per-panel content

### Top toolbar (48px)

| Element | Behavior |
|---|---|
| ← Back | Link to `/dashboard` (products list) |
| Product name | Static text from product API |
| 🎵 Audio pill | `Not set` (orange) / `28:14` (green). Click → `AudioDialog`. Replacing audio while sections exist → confirm modal "Audio duration changed; sections will need re-parse." |
| 📝 Script pill | `Not set` / `42 sections`. Click → `ScriptDialog`. On save → runs lock-preservation diff (see below). |
| [▶ Export] | Disabled until audio + script + timeline ready. Click → `ExportDialog` (wraps `RenderTrigger`). |

### Library panel (left, 320px, may grow to 360)

`FolderSidebar` collapsed to icon-only (40px) by default to save horizontal space — click a folder to expand list as a flyout. `ClipGrid` fills the rest. Search input (existing `fileQuery`) above grid. Upload via "+" / drop into grid (existing `clip-upload`). **Drag-to-timeline is out of scope for v1**.

### Preview player (center, flex-1)

- 9:16 box centered in the column; surrounding space is editor background.
- Single `<video>` + separate `<audio>` element (master audio).
- `selectedSectionIndex === null` → poster (first frame of section 0 if present, else logo).
- Section selected → load that section's chain:
  - **Single-clip:** `video.src = ObjectURL(blob); video.playbackRate = speedFactor`
  - **Multi-clip chain:** imperative sequencing — on `timeupdate` ≥ end, swap `src` to next clip; same `speedFactor` for all.
- `<audio>` seeks to section start (sum of prior section durations) and plays in sync. Audio is **never speed-shifted** (speedFactor is video-only).
- Below the box: play/pause + time readout. **No global timeline scrubber in v1**.

**v2-ready API:**

```ts
type PlaybackPlan = {
  clips: { srcUrl: string; startMs: number; endMs: number; speedFactor: number }[];
  audioUrl: string;
  audioStartMs: number;
};

interface PreviewPlayerHandle {
  loadPlan(plan: PlaybackPlan): void;
  play(): void;
  pause(): void;
  seek(ms: number): void;
}
```

v1 generates a `PlaybackPlan` for one section; v2 generates one for the entire timeline. Same component.

### Timeline (bottom, 220px, full-width)

Stacked vertically:

- **Ruler (20px)** — time labels at 5/10/30s ticks based on zoom.
- **Tags track (40px)** — colored pill per section, width ∝ duration. Status: 🟡 high-speed, 🔵 locked, 🔴 dashed if missing/placeholder.
- **Clips track (90px)** — row of thumbnails for each chain. `getThumbnail(clipId)`. Speed badge in corner if ≠ 1.0.
- **Audio track (50px)** — `<canvas>` waveform via Web Audio API peaks (decode once on audio load, cache peaks per zoom level).

**Playhead** — orange vertical line; position from preview's `timeupdate`.

**Click** — tag or clip block → `setSelectedSectionIndex(i)` and seek preview to that section's start. Audio track / ruler click → seek preview within current section only (v1).

**Zoom** — `+`/`-` buttons + ⌘scroll. Stores `pixelsPerSecond` in state. Default fits whole video in panel.

**No drag-reorder, no trim handles, no in-place clip swap.** All section editing happens in the inspector.

### Inspector (right, 360px)

When `selectedSectionIndex !== null`:

- Header: tag · `formatMs(durationMs)` · 🔵 lock badge · ✕ close (deselects)
- Mini preview pane (existing `preview-pane.tsx`)
- Chain strip (extracted from `chain-strip.tsx`) — picked clips with × remove, + add
- Variant grid (extracted from `variant-grid.tsx`) — clips sharing `baseName`. Click → add to chain
- Speed factor readout + warning (existing `validateChain`)
- Reset to auto-pick · Save (sets `userLocked: true`)

When `selectedSectionIndex === null`:

- "Click a section in the timeline to edit it"
- Quick stats: `X/Y sections matched · Z locked · A high-speed warnings`

The existing `SectionEditorDialog` is **deleted** — its body becomes `inspector-panel.tsx`. Dialog wrapper goes away.

## Lock preservation (script re-paste)

In `lib/lock-preserve.ts` (pure, unit-tested):

```ts
export interface LockPreserveResult {
  newTimeline: MatchedSection[];
  preservedCount: number;
  droppedCount: number;
}

export function preserveLocks(
  oldTimeline: MatchedSection[],
  newSections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
): LockPreserveResult;
```

Algorithm:

1. Pull old locked sections in order: `lockedQueue = oldTimeline.filter(s => s.userLocked)`.
2. For each `newSection` left-to-right:
   - Peek `lockedQueue[0]`. If `tag` matches AND `|newDur - oldDur| / oldDur ≤ 0.20` → consume it: produce a `MatchedSection` carrying its `clips` and `userLocked: true`, but with `durationMs = newDur` and a recomputed `speedFactor` based on new duration. Increment `preservedCount`.
   - Else → run `matchSections([newSection], clipsByBaseName)` for fresh auto-pick.
3. Any `lockedQueue` items left unconsumed → `droppedCount = lockedQueue.length`.

After build, fire a toast: `"42 sections · 7 locks preserved · 2 dropped"` with **Undo** (snapshot the previous timeline; restoring within 30s reverts).

## Edge & error states

| Situation | Behavior |
|---|---|
| Audio not set + script not set | Editor renders. Pills orange. Inspector: "Set audio + paste script to begin." |
| Audio set, script not set | Library + audio waveform render. Tags/clips tracks empty state. |
| Script set, audio not set | Sections parse. Timeline greyed (durations require audio). |
| Tag has no matching b-roll | Today's red dashed placeholder block. Inspector: "No clips match `[tag]`." |
| Chain too slow (`<0.8×`) | Existing `validateChain` blocks Save; error inline in inspector. |
| Render fails | Existing `RenderTrigger` error state, surfaced inside ExportDialog. |
| Audio replaced after script set | Confirm modal: "Audio length changed; re-parse script? Locks for sections that no longer fit may drop." → re-parse + lock-diff. |
| Browser refresh | Lose all editor state. Same as today. v1 accepts. |

## Testing strategy

- **Unit (vitest):**
  - `lib/lock-preserve.ts` — typo fix, section added, section reordered, all tags changed, duration shrinks past tolerance.
  - Existing `auto-match.ts`, `script-parser.ts` tests stay.
- **Component:**
  - `EditorShell` renders all panels in correct positions.
  - `TimelinePanel` click → emits correct `selectedSectionIndex`.
  - `InspectorPanel` mode switching (`section` ↔ `empty`).
  - Toolbar pills reflect state badges correctly.
- **E2E:** none for v1 (revisit when v2 lands).

## Acceptance bar (what "v1 done" means)

A user can:

1. Open `/dashboard/[productId]`.
2. Set audio via toolbar pill.
3. Paste script via toolbar pill — sections appear in the timeline auto-matched.
4. Click any section in timeline → preview plays it; inspector shows variants + chain.
5. Edit variants in inspector → save → see updated chain in timeline; section is locked.
6. Re-paste script with edits → most locks preserved; toast shows summary; Undo available.
7. Click Export → render produces the same MP4 the current pipeline produces.
8. All flows happen on one page; no tab switching.

## Implementation sketch (high-level — full plan to be drafted via writing-plans)

Likely phasing (to be decided in the implementation plan):

1. **Skeleton.** New shell + 4-panel grid + routing changes; existing pages still mounted in the slots so nothing breaks. Ship dark.
2. **Toolbar pills + dialogs.** Move audio + script entry into pills; old wizard rendered hidden behind a flag.
3. **Inspector.** Extract chain-strip + variant-grid + preview-pane out of `SectionEditorDialog`; mount in inspector.
4. **Timeline panel.** Build 3 tracks; replace today's `TimelinePreview`.
5. **Preview player.** Build `PreviewPlayer` with the `PlaybackPlan` API; per-section v1.
6. **Lock preservation.** Extract `lib/lock-preserve.ts` + wire into ScriptDialog save flow.
7. **Export.** Wrap `RenderTrigger` in dialog. Wire toolbar Export button.
8. **Cleanup.** Delete `/build` route, delete `SectionEditorDialog`, delete legacy `TimelinePreview`, delete tab-strip from layout.

The detailed task breakdown, ordering, and verification steps live in the implementation plan, not in this design doc.
