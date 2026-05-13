# Shuffle All B-roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Shuffle" action that re-rolls all auto-matched B-roll sections while preserving user-locked sections and talking-head slices.

**Architecture:** A pure helper (`src/lib/shuffle.ts`) iterates the existing timeline, keeps locked + talking-head sections verbatim while threading their picks into `MatchState` via `markUsed` so cooldown carries, and routes auto sections through the existing `matchSections` matcher with a fresh `MatchState`. A `shuffleTimeline` method on `BuildState` wires the helper to the current media pool, fires a sonner toast with counts, and resets `previewClipKey`. A `ShuffleButton` component mounts in the editor toolbar next to Export.

**Tech Stack:** TypeScript, React 19, Next.js App Router, vitest, sonner (already installed), lucide-react.

**Spec:** [docs/superpowers/specs/2026-05-13-shuffle-all-broll-design.md](../specs/2026-05-13-shuffle-all-broll-design.md)

---

## File Structure

- **Create** `src/lib/shuffle.ts` — pure `shuffleTimeline` helper + `ShuffleResult` type
- **Create** `src/lib/__tests__/shuffle.test.ts` — vitest unit tests
- **Create** `src/components/editor/toolbar/shuffle-button.tsx` — toolbar button
- **Modify** `src/components/build/build-state-context.tsx` — add `shuffleTimeline` method + toast formatter
- **Modify** `src/components/editor/editor-shell.tsx` — mount `<ShuffleButton />` before `<ExportButton />`

---

## Task 1: Pure `shuffleTimeline` helper + tests

**Files:**
- Create: `src/lib/shuffle.ts`
- Create: `src/lib/__tests__/shuffle.test.ts`

Reference: existing tests at [src/lib/__tests__/auto-match.test.ts](../../../src/lib/__tests__/auto-match.test.ts) for `makeClip` / `makeSection` fixture style.

### Step 1.1: Write the test file with all scenarios

- [ ] Create `src/lib/__tests__/shuffle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shuffleTimeline } from "../shuffle";
import {
  buildClipsByBaseName,
  TALKING_HEAD_FILE_ID,
  type ClipMetadata,
  type MatchedSection,
} from "../auto-match";

const makeClip = (brollName: string, durationMs: number): ClipMetadata => ({
  id: brollName,
  brollName,
  baseName: brollName.replace(/-\d+$/, ""),
  durationMs,
  fileId: brollName,
  folderId: "f1",
  filename: `${brollName}.mp4`,
  width: 1080,
  height: 1350,
  fileSizeBytes: 1000,
  createdAt: new Date(),
});

const autoSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
  clipId: string,
  fileId: string,
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: [{ clipId, fileId, speedFactor: 1, trimDurationMs: durationMs, isPlaceholder: false }],
  warnings: [],
});

const lockedSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
  picks: { clipId: string; fileId: string }[],
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: picks.map((p) => ({ ...p, speedFactor: 1, isPlaceholder: false })),
  warnings: [],
  userLocked: true,
});

const thSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: [
    {
      clipId: "talking-head",
      fileId: TALKING_HEAD_FILE_ID,
      speedFactor: 1,
      trimDurationMs: durationMs,
      sourceSeekMs: startMs,
      isPlaceholder: false,
    },
  ],
  warnings: [],
});

const placeholderSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: [{ clipId: "placeholder", fileId: "", speedFactor: 1, isPlaceholder: true }],
  warnings: [],
});

const seededRng = (seed: number) => () => {
  // Mulberry32 — small deterministic PRNG, fine for tests.
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("shuffleTimeline", () => {
  it("preserves talking-head sections byte-for-byte", () => {
    const old = [thSection(0, "talking-head", 0, 1000), thSection(1, "talking-head", 1000, 1000)];
    const result = shuffleTimeline(old, new Map(), null, seededRng(1));
    expect(result.newTimeline).toEqual(old);
    expect(result.talkingHeadCount).toBe(2);
    expect(result.shuffledCount).toBe(0);
    expect(result.lockedKeptCount).toBe(0);
    expect(result.placeholderCount).toBe(0);
  });

  it("preserves userLocked sections", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000), makeClip("hook-03", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      lockedSection(0, "hook", 0, 2000, [{ clipId: "hook-01", fileId: "hook-01" }]),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[0]).toEqual(old[0]);
    expect(result.lockedKeptCount).toBe(1);
    expect(result.shuffledCount).toBe(0);
  });

  it("re-rolls auto sections through the matcher", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [autoSection(0, "hook", 0, 2000, "hook-01", "hook-01")];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.shuffledCount).toBe(1);
    expect(result.newTimeline[0]!.clips[0]!.isPlaceholder).toBe(false);
    expect(["hook-01", "hook-02"]).toContain(result.newTimeline[0]!.clips[0]!.clipId);
  });

  it("is deterministic for a fixed rng seed", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000), makeClip("hook-03", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      autoSection(0, "hook", 0, 2000, "hook-01", "hook-01"),
      autoSection(1, "hook", 2000, 2000, "hook-02", "hook-02"),
    ];
    const a = shuffleTimeline(old, idx, null, seededRng(42));
    const b = shuffleTimeline(old, idx, null, seededRng(42));
    expect(a.newTimeline).toEqual(b.newTimeline);
  });

  it("locked clips contribute to cooldown for adjacent auto sections", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      lockedSection(0, "hook", 0, 2000, [{ clipId: "hook-01", fileId: "hook-01" }]),
      autoSection(1, "hook", 2000, 2000, "hook-01", "hook-01"),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    // Section[1] must avoid hook-01 because the locked section just used it
    // (cooldown = min(pool-1, MAX_COOLDOWN) = 1).
    expect(result.newTimeline[1]!.clips[0]!.clipId).toBe("hook-02");
    expect(result.lockedKeptCount).toBe(1);
    expect(result.shuffledCount).toBe(1);
  });

  it("section with no candidate tag returns placeholder", () => {
    const idx = buildClipsByBaseName([]);
    const old = [autoSection(0, "unknown-tag", 0, 2000, "x", "x")];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[0]!.clips[0]!.isPlaceholder).toBe(true);
    expect(result.placeholderCount).toBe(1);
    expect(result.shuffledCount).toBe(0);
  });

  it("preserves sectionIndex from the old timeline", () => {
    const clips = [makeClip("hook-01", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      autoSection(7, "hook", 0, 2000, "hook-01", "hook-01"),
      autoSection(9, "hook", 2000, 2000, "hook-01", "hook-01"),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[0]!.sectionIndex).toBe(7);
    expect(result.newTimeline[1]!.sectionIndex).toBe(9);
  });

  it("mixed timeline counts each category correctly", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      thSection(0, "talking-head", 0, 1000),
      lockedSection(1, "hook", 1000, 2000, [{ clipId: "hook-01", fileId: "hook-01" }]),
      autoSection(2, "hook", 3000, 2000, "hook-01", "hook-01"),
      placeholderSection(3, "unknown", 5000, 2000),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.talkingHeadCount).toBe(1);
    expect(result.lockedKeptCount).toBe(1);
    expect(result.shuffledCount).toBe(1);
    expect(result.placeholderCount).toBe(1);
  });
});
```

### Step 1.2: Run the tests — expect failure (module missing)

- [ ] Run:

```bash
pnpm test src/lib/__tests__/shuffle.test.ts
```

Expected: FAIL with `Cannot find module '../shuffle'` or similar.

### Step 1.3: Implement `src/lib/shuffle.ts`

- [ ] Create the file with:

```ts
import {
  createMatchState,
  markUsed,
  matchSections,
  type ClipMetadata,
  type MatchedSection,
  type TalkingHeadConfig,
} from "./auto-match";
import type { ParsedSection } from "./script-parser";

export interface ShuffleResult {
  newTimeline: MatchedSection[];
  /** Auto sections that ran through matchSections and produced a real (non-placeholder) pick. */
  shuffledCount: number;
  /** Sections preserved because userLocked === true. */
  lockedKeptCount: number;
  /** Sections preserved because they are talking-head slices. */
  talkingHeadCount: number;
  /** Auto sections that re-rolled to a placeholder (no candidate clip). */
  placeholderCount: number;
}

/**
 * Detects a talking-head section by the presence of `sourceSeekMs` on any clip.
 * This matches the discriminator used elsewhere (editor-shell inspector).
 */
function isTalkingHeadSection(section: MatchedSection): boolean {
  return section.clips.some((c) => c.sourceSeekMs !== undefined);
}

/**
 * Re-rolls all auto-matched B-roll sections while preserving:
 *  - userLocked sections (clips + speedFactor untouched)
 *  - talking-head sections (deterministic by tag, never re-rolled)
 *
 * Locked sections' real clips are fed into MatchState via markUsed before
 * subsequent auto-section matching so adjacency cooldown carries correctly.
 *
 * Pure apart from the supplied `rng` (defaults to Math.random).
 */
export function shuffleTimeline(
  oldTimeline: MatchedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  talkingHead?: TalkingHeadConfig | null,
  rng: () => number = Math.random,
): ShuffleResult {
  const state = createMatchState(rng);
  const newTimeline: MatchedSection[] = [];
  let shuffledCount = 0;
  let lockedKeptCount = 0;
  let talkingHeadCount = 0;
  let placeholderCount = 0;

  for (const section of oldTimeline) {
    if (isTalkingHeadSection(section)) {
      newTimeline.push(section);
      talkingHeadCount++;
      continue;
    }

    if (section.userLocked) {
      newTimeline.push(section);
      const tagKey = section.tag.toLowerCase();
      for (const c of section.clips) {
        if (!c.isPlaceholder) markUsed(state, tagKey, c.clipId);
      }
      lockedKeptCount++;
      continue;
    }

    // Auto section — rebuild a ParsedSection shape and route through matchSections.
    // lineNumber/scriptText are unused by the matcher; safe stubs are fine.
    const ps: ParsedSection = {
      lineNumber: 0,
      scriptText: "",
      tag: section.tag,
      startTime: section.startMs / 1000,
      endTime: section.endMs / 1000,
      durationMs: section.durationMs,
    };
    const matched = matchSections([ps], clipsByBaseName, state, talkingHead ?? undefined)[0]!;
    matched.sectionIndex = section.sectionIndex;
    newTimeline.push(matched);

    const allPlaceholder = matched.clips.every((c) => c.isPlaceholder);
    if (allPlaceholder) placeholderCount++;
    else shuffledCount++;
  }

  return { newTimeline, shuffledCount, lockedKeptCount, talkingHeadCount, placeholderCount };
}
```

### Step 1.4: Run tests — expect all pass

- [ ] Run:

```bash
pnpm test src/lib/__tests__/shuffle.test.ts
```

Expected: 8 tests pass.

### Step 1.5: Run lint + typecheck

- [ ] Run:

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

### Step 1.6: Commit

- [ ] Run:

```bash
git add src/lib/shuffle.ts src/lib/__tests__/shuffle.test.ts
git commit -m "feat(shuffle): pure shuffleTimeline helper with tests

Iterates an existing timeline and re-rolls only auto-matched sections.
Locked sections + talking-head slices pass through unchanged. Locked
picks are threaded into MatchState via markUsed so cooldown carries
across the lock boundary. Returns per-category counts for UI feedback."
```

---

## Task 2: Wire `shuffleTimeline` into BuildState with toast

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

### Step 2.1: Add imports

- [ ] In `src/components/build/build-state-context.tsx`, find this import block at the top (around line 4-11):

```ts
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { MatchedSection } from "@/lib/auto-match";
import { buildClipsByBaseName, TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
import { preserveLocks } from "@/lib/lock-preserve";
import type { ParsedSection } from "@/lib/script-parser";
import type { OverlayItem } from "@/lib/overlay/overlay-types";
import { useMediaPool } from "@/state/media-pool";
```

Add two new imports immediately after the existing ones:

```ts
import { toast } from "sonner";
import { shuffleTimeline as shuffleTimelineHelper, type ShuffleResult } from "@/lib/shuffle";
```

### Step 2.2: Add `shuffleTimeline: () => void` to the `BuildState` interface

- [ ] Locate the `setTimeline` line in the `BuildState` interface (around line 22) and add a new field right after `setTimeline`:

```ts
  timeline: MatchedSection[] | null;
  setTimeline: (t: MatchedSection[]) => void;
  shuffleTimeline: () => void;
  onParsed: (s: ParsedSection[], t: MatchedSection[]) => void;
```

### Step 2.3: Add the toast formatter + `shuffleTimeline` implementation inside `BuildStateProvider`

- [ ] In `BuildStateProvider`, find the `onParsed` function (around line 167):

```ts
  function onParsed(s: ParsedSection[], t: MatchedSection[]) {
    setSections(s);
    setTimeline(t);
    setSelectedSectionIndex(null);
  }
```

Insert this new function immediately above `onParsed`:

```ts
  function buildShuffleToast(result: ShuffleResult): string {
    const parts = [`Shuffled ${result.shuffledCount} section${result.shuffledCount === 1 ? "" : "s"}`];
    if (result.lockedKeptCount > 0) parts.push(`${result.lockedKeptCount} locked kept`);
    if (result.talkingHeadCount > 0) parts.push(`${result.talkingHeadCount} talking-head`);
    if (result.placeholderCount > 0) parts.push(`${result.placeholderCount} unmatched`);
    return parts.join(" · ");
  }

  function shuffleTimeline() {
    if (!timeline) return;
    const clipsByBaseName = buildClipsByBaseName(mediaPoolClips);
    const thConfig = talkingHeadFile && talkingHeadTag.length > 0
      ? { fileId: TALKING_HEAD_FILE_ID, tag: talkingHeadTag }
      : null;
    const result = shuffleTimelineHelper(timeline, clipsByBaseName, thConfig);
    setTimeline(result.newTimeline);
    setPreviewClipKey(null);
    toast.success(buildShuffleToast(result));
  }
```

### Step 2.4: Expose `shuffleTimeline` in the context value

- [ ] Find the `useMemo` `value` block (around line 195-235). Locate the `setTimeline,` line and add `shuffleTimeline,` right after it:

```ts
      timeline,
      setTimeline,
      shuffleTimeline,
      onParsed,
      clearParsed,
```

### Step 2.5: Run typecheck + lint

- [ ] Run:

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors. The `useMemo` deps array does not need `shuffleTimeline` because it's a function defined inline in render and depends on the same state already tracked (`timeline`, `talkingHeadFile`, etc.); the existing pattern in this file (e.g., `onParsed`, `clearParsed`) follows the same convention.

### Step 2.6: Commit

- [ ] Run:

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(shuffle): expose shuffleTimeline action on BuildState

Wires the pure shuffle helper to the current media pool snapshot and
talking-head config, replaces timeline state on click, closes any open
clip preview, and surfaces per-category counts via sonner toast."
```

---

## Task 3: Toolbar `ShuffleButton`

**Files:**
- Create: `src/components/editor/toolbar/shuffle-button.tsx`
- Modify: `src/components/editor/editor-shell.tsx`

### Step 3.1: Create the button component

- [ ] Create `src/components/editor/toolbar/shuffle-button.tsx`:

```tsx
"use client";

import { Shuffle } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { Button } from "@/components/ui/button";

export function ShuffleButton() {
  const { timeline, shuffleTimeline } = useBuildState();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!timeline}
      onClick={shuffleTimeline}
      title="Re-roll all auto-matched B-roll sections"
    >
      <Shuffle className="w-3.5 h-3.5 mr-1.5" />
      Shuffle
    </Button>
  );
}
```

### Step 3.2: Mount it in the editor shell

- [ ] In `src/components/editor/editor-shell.tsx`, find the imports for `ExportButton` (around line 12):

```tsx
import { ExportButton } from "./toolbar/export-button";
```

Add immediately after it:

```tsx
import { ShuffleButton } from "./toolbar/shuffle-button";
```

- [ ] Find this block (around line 92-94):

```tsx
        <div className="ml-auto">
          <ExportButton />
        </div>
```

Replace it with:

```tsx
        <div className="ml-auto flex items-center gap-2">
          <ShuffleButton />
          <ExportButton />
        </div>
```

### Step 3.3: Run typecheck + lint

- [ ] Run:

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

### Step 3.4: Commit

- [ ] Run:

```bash
git add src/components/editor/toolbar/shuffle-button.tsx src/components/editor/editor-shell.tsx
git commit -m "feat(shuffle): toolbar Shuffle button next to Export

Outline-variant button, disabled when timeline is null, triggers
BuildState.shuffleTimeline() on click."
```

---

## Task 4: Manual smoke verification

**Files:** none

### Step 4.1: Start the dev server

- [ ] Run:

```bash
pnpm dev
```

Open the URL printed (typically http://localhost:3000).

### Step 4.2: Pre-shuffle setup

- [ ] In the browser:
  1. Load the existing demo project (audio + folders should already be in IDB from prior sessions, per screenshot showing 73 sections + 192 clips). If empty, upload audio + paste a script + add a few B-roll folders.
  2. Confirm timeline is populated (visible in the timeline panel at the bottom).
  3. Note 2-3 specific section clip choices visually (which thumbnail appears in which slot).
  4. Confirm the "Shuffle" button appears between "B-roll Editor" header and the "Export" button, and is enabled.

### Step 4.3: Shuffle test cases

- [ ] **Case 1 — basic shuffle:** Click Shuffle. Verify:
  - At least some thumbnails change in the timeline.
  - Toast appears top-right: `Shuffled N sections · M talking-head` (M = ~9 talking-head sections per screenshot).
  - The talking-head sections (visible by purple-dashed border) remain in identical positions.

- [ ] **Case 2 — rapid double-click:** Click Shuffle twice quickly. Verify:
  - No crash, no console errors (open devtools).
  - Final timeline is a valid shuffle (talking-head + any locks preserved).

- [ ] **Case 3 — locked section preserved:** If section-locking UI is not exposed yet, simulate by manually setting `userLocked: true` on one entry via React DevTools (or skip and rely on Task 1's automated test).

- [ ] **Case 4 — disabled state:** Click trash-can "Clear all" to wipe timeline. Verify the Shuffle button becomes disabled (greyed out, no pointer cursor).

- [ ] **Case 5 — preview reset:** Click a B-roll thumbnail in the timeline to open the click-to-preview. Then click Shuffle. Verify the preview popover closes.

### Step 4.4: Cleanup

- [ ] Stop dev server (Ctrl+C). No commit for this task.

---

## Self-review

**Spec coverage check** against [docs/superpowers/specs/2026-05-13-shuffle-all-broll-design.md](../specs/2026-05-13-shuffle-all-broll-design.md):

- Helper signature `shuffleTimeline(oldTimeline, clipsByBaseName, talkingHead?, rng?)` returning counts → Task 1 ✓
- TH preservation via `sourceSeekMs` discriminator → Task 1.3 + test ✓
- Locked preservation + `markUsed` for cooldown → Task 1.3 + test ✓
- `sectionIndex` carry-over → Task 1.3 + test ✓
- Auto sections through `matchSections` with fresh `MatchState` → Task 1.3 ✓
- Counts: shuffled/lockedKept/talkingHead/placeholder → Task 1.3 + mixed-counts test ✓
- BuildState `shuffleTimeline: () => void` exposed → Task 2.2, 2.3, 2.4 ✓
- Rebuild `clipsByBaseName` from current `mediaPoolClips` per click → Task 2.3 ✓
- `setPreviewClipKey(null)` after shuffle → Task 2.3 ✓
- `selectedSectionIndex` preserved (do nothing) → Task 2.3 (no explicit reset) ✓
- Toast text format: "Shuffled N sections · K locked kept · M talking-head" with conditional placeholder count → Task 2.3 ✓
- Disable when `timeline === null` → Task 3.1 ✓
- Mount between header and Export → Task 3.2 ✓
- Race condition with rapid clicks accepted → Task 4.3 Case 2 verifies no crash ✓
- Unit + seeded-RNG tests → Task 1.1 ✓

**Placeholder scan:** No "TBD", "TODO", "later". All code blocks contain full implementations. All file paths are exact. All commands are runnable as-shown.

**Type consistency:** `shuffleTimeline` is the public export name in `src/lib/shuffle.ts` and the method name on `BuildState`. The import in `build-state-context.tsx` aliases the helper as `shuffleTimelineHelper` to disambiguate — verified in Step 2.1. `ShuffleResult` type is exported from the helper file (Task 1.3) and imported in BuildState (Step 2.1). All test fixtures match the real types defined in [src/lib/auto-match.ts](../../../src/lib/auto-match.ts).
