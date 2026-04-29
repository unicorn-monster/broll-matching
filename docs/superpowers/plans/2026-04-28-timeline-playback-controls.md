# Timeline Playback Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a functional play/pause button and live current-time / total-time display to the TimelinePanel header, and fix the broken time display in PreviewPlayer.

**Architecture:** Lift `isPlaying` boolean and `playerTogglePlayRef` into `BuildStateContext` so both `PreviewPlayer` (which owns the audio element) and `TimelinePanel` (which shows the controls) share the same state. `PreviewPlayer` replaces its local `playing` state with context state, registers `playerTogglePlayRef`, and uses `playheadMs` from context for the time display. `TimelinePanel` reads `isPlaying` and `playheadMs` from context and calls `playerTogglePlayRef.current?.()` to toggle.

**Tech Stack:** React state/refs, lucide-react icons, existing `formatMs` utility, existing `useBuildState` hook.

---

### Task 1: Extend BuildStateContext with `isPlaying` and `playerTogglePlayRef`

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Add `isPlaying` state and `playerTogglePlayRef` ref to the provider**

  In `build-state-context.tsx`, add the following after the `playerSeekRef` line (line 62):

  ```tsx
  const [isPlaying, setIsPlaying] = useState(false);
  const playerTogglePlayRef = useRef<(() => void) | null>(null);
  ```

- [ ] **Step 2: Add the new fields to the `BuildState` interface**

  Add after `playerSeekRef` in the interface (after line 43):

  ```tsx
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  playerTogglePlayRef: MutableRefObject<(() => void) | null>;
  ```

- [ ] **Step 3: Include new fields in the `value` object and `useMemo` deps**

  In the `useMemo` return object (after `playerSeekRef`), add:
  ```tsx
  isPlaying,
  setIsPlaying,
  playerTogglePlayRef,
  ```

  In the `useMemo` dependency array, add `isPlaying`.

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /Users/quanghuy/Documents/mix-n-match-vsl && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors related to `build-state-context.tsx`.

---

### Task 2: Migrate PreviewPlayer to use context `isPlaying` and fix time display

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Destructure new context values**

  Replace the existing `useBuildState()` destructuring in `PreviewPlayer` (lines 22-31) with:

  ```tsx
  const {
    audioFile,
    timeline,
    selectedSectionIndex,
    setSelectedSectionIndex,
    playheadMs,
    setPlayheadMs,
    playerSeekRef,
    previewClipKey,
    isPlaying,
    setIsPlaying,
    playerTogglePlayRef,
  } = useBuildState();
  ```

- [ ] **Step 2: Remove local `playing` state**

  Delete this line (currently line 38):
  ```tsx
  const [playing, setPlaying] = useState(false);
  ```

- [ ] **Step 3: Replace all `playing` / `setPlaying` with `isPlaying` / `setIsPlaying`**

  Do a find-and-replace in this file:
  - `playing` → `isPlaying` (for reads)
  - `setPlaying(true)` → `setIsPlaying(true)`
  - `setPlaying(false)` → `setIsPlaying(false)`

  Affected locations: rAF useEffect condition (line 149), rAF `audio.ended` branch (line 163), spacebar handler (lines 248-255), `togglePlay` function (lines 263-274), play button aria-label (line 315), play button icon (line 317).

- [ ] **Step 4: Register `playerTogglePlayRef` on mount**

  Add a new `useEffect` after the `playerSeekRef` registration effect (after line 144):

  ```tsx
  useEffect(() => {
    playerTogglePlayRef.current = togglePlay;
  });
  ```

  Note: no dependency array — this runs after every render so `togglePlay` closure is always fresh (same pattern works because `togglePlay` references refs, not stale state).

- [ ] **Step 5: Fix time display to use `playheadMs` from context**

  Replace the time span (currently line 320-323):
  ```tsx
  <span className="font-mono">
    {formatMs((audioRef.current?.currentTime ?? 0) * 1000)} / {formatMs(totalMs)}
  </span>
  ```
  With:
  ```tsx
  <span className="font-mono">
    {formatMs(playheadMs)} / {formatMs(totalMs)}
  </span>
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  cd /Users/quanghuy/Documents/mix-n-match-vsl && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors.

---

### Task 3: Add play/pause button and time display to TimelinePanel header

**Files:**
- Modify: `src/components/editor/timeline/timeline-panel.tsx`

- [ ] **Step 1: Import Play, Pause icons and update useBuildState destructuring**

  The file already imports `Plus, Minus` from `lucide-react`. Add `Play, Pause`:
  ```tsx
  import { Plus, Minus, Play, Pause } from "lucide-react";
  ```

  Update the `useBuildState()` destructuring to include:
  ```tsx
  const {
    timeline,
    audioFile,
    audioDuration,
    selectedSectionIndex,
    setSelectedSectionIndex,
    playheadMs,
    playerSeekRef,
    isPlaying,
    playerTogglePlayRef,
  } = useBuildState();
  ```

- [ ] **Step 2: Add import for `formatMs`**

  ```tsx
  import { formatMs } from "@/lib/format-time";
  ```

- [ ] **Step 3: Replace the timeline header bar content**

  The current header (lines 68-78):
  ```tsx
  <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/20 text-xs">
    <span className="text-muted-foreground">Timeline</span>
    <div className="ml-auto flex items-center gap-1">
      <button onClick={() => zoom(0.8)} className="p-1 hover:bg-muted rounded" aria-label="Zoom out">
        <Minus className="w-3 h-3" />
      </button>
      <button onClick={() => zoom(1.25)} className="p-1 hover:bg-muted rounded" aria-label="Zoom in">
        <Plus className="w-3 h-3" />
      </button>
    </div>
  </div>
  ```

  Replace with:
  ```tsx
  <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/20 text-xs">
    {audioFile && (
      <button
        type="button"
        onClick={() => playerTogglePlayRef.current?.()}
        className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>
    )}
    <span className="font-mono text-muted-foreground">
      {formatMs(playheadMs)} / {formatMs(totalMs)}
    </span>
    <div className="ml-auto flex items-center gap-1">
      <button onClick={() => zoom(0.8)} className="p-1 hover:bg-muted rounded" aria-label="Zoom out">
        <Minus className="w-3 h-3" />
      </button>
      <button onClick={() => zoom(1.25)} className="p-1 hover:bg-muted rounded" aria-label="Zoom in">
        <Plus className="w-3 h-3" />
      </button>
    </div>
  </div>
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  cd /Users/quanghuy/Documents/mix-n-match-vsl && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors.

- [ ] **Step 5: Commit all changes**

  ```bash
  git add src/components/build/build-state-context.tsx \
          src/components/editor/preview/preview-player.tsx \
          src/components/editor/timeline/timeline-panel.tsx
  git commit -m "feat(timeline): add play/pause button and live time display to timeline header"
  ```
