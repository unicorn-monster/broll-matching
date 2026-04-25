# CapCut-style Unified Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-tab Library/Build flow with a single CapCut-style editor (4-panel: library · preview · inspector · timeline) at `/dashboard/[productId]`, preserving the existing mix-and-match logic and FFmpeg render pipeline.

**Architecture:** Refactor in place. New shell component owns the 4-panel grid; existing pure logic (`auto-match`, `script-parser`, `clip-storage`) reused unchanged; existing UI atoms (`AudioUpload`, `ScriptPaste`, `RenderTrigger`, `ChainStrip`, `VariantGrid`, `PreviewPane`, `FolderSidebar`, `ClipGrid`) are reparented into new dialogs/panels. New: editor shell, top toolbar, timeline tracks, inspector panel, preview player, lock-preservation logic.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind · Radix Dialog · Sonner toasts · Vitest · Web Audio API (waveform) · IndexedDB (existing clip storage) · FFmpeg.wasm (existing render worker).

**Spec:** [`docs/superpowers/specs/2026-04-26-capcut-editor-design.md`](../specs/2026-04-26-capcut-editor-design.md)

---

## File map

**New files:**

| Path | Responsibility |
|---|---|
| `src/lib/lock-preserve.ts` | Pure: diff old timeline against new sections, carry over `userLocked` clips when tag + duration match. |
| `src/lib/__tests__/lock-preserve.test.ts` | Vitest cases for lock-preserve. |
| `src/lib/playback-plan.ts` | Pure: build a `PlaybackPlan` for a section (or, in v2, multiple sections). |
| `src/lib/__tests__/playback-plan.test.ts` | Vitest cases for playback-plan builder. |
| `src/lib/waveform.ts` | Pure: compute waveform peaks from an `ArrayBuffer` audio file via Web Audio API. |
| `src/components/editor/editor-shell.tsx` | 4-panel CSS grid + top toolbar; mounts all panels. |
| `src/components/editor/toolbar/audio-pill.tsx` | Status pill + opens `AudioDialog`. |
| `src/components/editor/toolbar/script-pill.tsx` | Status pill + opens `ScriptDialog`. |
| `src/components/editor/toolbar/export-button.tsx` | Toolbar Export button + opens `ExportDialog`. |
| `src/components/editor/dialogs/audio-dialog.tsx` | Wraps `AudioUpload` + replace-confirmation. |
| `src/components/editor/dialogs/script-dialog.tsx` | Wraps `ScriptPaste` + lock-preservation save handler. |
| `src/components/editor/dialogs/export-dialog.tsx` | Wraps `RenderTrigger` in a dialog. |
| `src/components/editor/library/library-panel.tsx` | Sidebar + grid in 320px column; reuses `FolderSidebar` + `ClipGrid`. |
| `src/components/editor/preview/preview-player.tsx` | Single `<video>` + `<audio>` driven by `PlaybackPlan`. |
| `src/components/editor/timeline/timeline-panel.tsx` | Stacks ruler + 3 tracks; manages zoom + playhead. |
| `src/components/editor/timeline/timeline-ruler.tsx` | Time ticks. |
| `src/components/editor/timeline/track-tags.tsx` | Top track: section tag pills with status colors. |
| `src/components/editor/timeline/track-clips.tsx` | Middle track: clip-thumbnail strips per section. |
| `src/components/editor/timeline/track-audio.tsx` | Bottom track: canvas waveform. |
| `src/components/editor/inspector/inspector-panel.tsx` | Section editor body + empty state. |
| `src/components/editor/inspector/inspector-empty.tsx` | "Click a section…" + quick stats. |

**Modified files:**

| Path | Change |
|---|---|
| `src/app/dashboard/[productId]/layout.tsx` | Drop tab strip; keep `BuildStateProvider`. |
| `src/app/dashboard/[productId]/page.tsx` | Replace library page body with `<EditorShell />`. |
| `src/components/build/build-state-context.tsx` | Add `selectedSectionIndex`, `playheadMs`, dialog-open flags. |

**Deleted files (final cleanup phase):**

| Path | Reason |
|---|---|
| `src/app/dashboard/[productId]/build/page.tsx` | `/build` route gone. |
| `src/components/build/section-editor/section-editor-dialog.tsx` | Body moves into inspector. |
| `src/components/build/timeline-preview.tsx` | Replaced by `timeline-panel`. |
| `src/components/build/step-wrapper.tsx` | Wizard step UI no longer used. |

---

## Phase 0: Branch + scaffolding

### Task 0.1: Create feature branch and editor directory tree

**Files:**
- Create: `src/components/editor/.gitkeep` (placeholder so empty dirs commit)

- [ ] **Step 1: Create branch off main**

```bash
git checkout main
git pull
git checkout -b feat/capcut-editor
```

- [ ] **Step 2: Make editor directory tree**

```bash
mkdir -p src/components/editor/{toolbar,dialogs,library,preview,timeline,inspector}
touch src/components/editor/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/
git commit -m "chore(editor): scaffold component directories"
```

---

## Phase 1: Pure logic — lock preservation (TDD)

### Task 1.1: Write failing tests for `preserveLocks`

**Files:**
- Create: `src/lib/__tests__/lock-preserve.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// src/lib/__tests__/lock-preserve.test.ts
import { describe, it, expect } from "vitest";
import { preserveLocks } from "../lock-preserve";
import type { MatchedSection, ClipMetadata } from "../auto-match";
import type { ParsedSection } from "../script-parser";

const makeClip = (id: string, brollName: string, durationMs: number): ClipMetadata => ({
  id,
  brollName,
  baseName: brollName.replace(/-\d+$/, ""),
  durationMs,
  indexeddbKey: id,
  folderId: "f1",
  productId: "p1",
  filename: `${brollName}.mp4`,
  width: 1080,
  height: 1350,
  fileSizeBytes: 1000,
  createdAt: new Date(),
});

const makeMatched = (
  tag: string,
  durationMs: number,
  clipIds: string[],
  userLocked = false,
): MatchedSection => ({
  sectionIndex: 0,
  tag,
  durationMs,
  clips: clipIds.map((id) => ({
    clipId: id,
    indexeddbKey: id,
    speedFactor: 1,
    isPlaceholder: false,
  })),
  warnings: [],
  userLocked,
});

const makeParsed = (tag: string, durationMs: number, line = 1): ParsedSection => ({
  lineNumber: line,
  startTime: 0,
  endTime: durationMs / 1000,
  tag,
  scriptText: "",
  durationMs,
});

describe("preserveLocks", () => {
  it("preserves a locked section when tag and duration match exactly", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 5000)];
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.droppedCount).toBe(0);
    expect(result.newTimeline[0].userLocked).toBe(true);
    expect(result.newTimeline[0].clips[0].clipId).toBe("c1");
  });

  it("preserves locks within ±20% duration tolerance and recomputes speedFactor", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 5500)]; // +10%
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.newTimeline[0].clips[0].speedFactor).toBeCloseTo(5000 / 5500, 4);
    expect(result.newTimeline[0].durationMs).toBe(5500);
  });

  it("drops a lock when duration differs by more than 20%", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 7000)]; // +40%
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(0);
    expect(result.droppedCount).toBe(1);
    expect(result.newTimeline[0].userLocked).toBeFalsy();
  });

  it("drops a lock when tag changes", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("clipper", 5000)];
    const map = new Map([
      ["hook", [makeClip("c1", "hook-01", 5000)]],
      ["clipper", [makeClip("c2", "clipper-01", 5000)]],
    ]);

    const result = preserveLocks(old, newSections, map);

    expect(result.droppedCount).toBe(1);
    expect(result.newTimeline[0].tag).toBe("clipper");
    expect(result.newTimeline[0].userLocked).toBeFalsy();
    expect(result.newTimeline[0].clips[0].clipId).toBe("c2");
  });

  it("auto-matches new sections that have no locked counterpart", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 5000), makeParsed("clipper", 4000)];
    const map = new Map([
      ["hook", [makeClip("c1", "hook-01", 5000)]],
      ["clipper", [makeClip("c2", "clipper-01", 4000)]],
    ]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.newTimeline).toHaveLength(2);
    expect(result.newTimeline[1].tag).toBe("clipper");
    expect(result.newTimeline[1].userLocked).toBeFalsy();
  });

  it("ignores unlocked sections in old timeline (always re-auto-matches)", () => {
    const old = [makeMatched("hook", 5000, ["c1"], false)];
    const newSections = [makeParsed("hook", 5000)];
    const map = new Map([["hook", [makeClip("c2", "hook-02", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(0);
    expect(result.droppedCount).toBe(0);
    expect(result.newTimeline[0].clips[0].clipId).toBe("c2");
  });

  it("matches greedily left-to-right, not by similarity", () => {
    // Two locked [hook] sections; new script reorders them. Greedy = first lock matches first new.
    const c1 = makeClip("c1", "hook-01", 5000);
    const c2 = makeClip("c2", "hook-02", 6000);
    const old = [
      makeMatched("hook", 5000, ["c1"], true),
      makeMatched("hook", 6000, ["c2"], true),
    ];
    const newSections = [makeParsed("hook", 6000), makeParsed("hook", 5000)];
    const map = new Map([["hook", [c1, c2]]]);

    const result = preserveLocks(old, newSections, map);

    // First new (6000ms) consumes first lock (5000ms): tolerance check |6000-5000|/5000 = 0.20
    // exactly = within, so consumed (boundary inclusive).
    expect(result.preservedCount).toBe(2);
    expect(result.newTimeline[0].clips[0].clipId).toBe("c1");
    expect(result.newTimeline[1].clips[0].clipId).toBe("c2");
  });

  it("counts unconsumed locks as dropped when new script has fewer sections", () => {
    const old = [
      makeMatched("hook", 5000, ["c1"], true),
      makeMatched("clipper", 4000, ["c2"], true),
    ];
    const newSections = [makeParsed("hook", 5000)];
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.droppedCount).toBe(1);
    expect(result.newTimeline).toHaveLength(1);
  });

  it("returns empty timeline when newSections is empty", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const result = preserveLocks(old, [], new Map());
    expect(result.newTimeline).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test src/lib/__tests__/lock-preserve.test.ts
```

Expected: all tests fail with `Cannot find module '../lock-preserve'`.

### Task 1.2: Implement `preserveLocks`

**Files:**
- Create: `src/lib/lock-preserve.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/lock-preserve.ts
import { matchSections, type MatchedSection, type ClipMetadata } from "./auto-match";
import type { ParsedSection } from "./script-parser";

const DURATION_TOLERANCE = 0.20;

export interface LockPreserveResult {
  newTimeline: MatchedSection[];
  preservedCount: number;
  droppedCount: number;
}

/**
 * Build a new timeline from new parsed sections, carrying over user-locked picks
 * from the old timeline when a (tag, duration±20%) match is found left-to-right.
 *
 * Sections without a matched lock are re-auto-matched fresh via `matchSections`.
 * Unlocked sections in `oldTimeline` are ignored — they're always re-auto-matched.
 *
 * The recomputed `speedFactor` for a preserved chain is `sumPickedDurations / newDurationMs`,
 * so the chain still plays exactly to fit the (possibly slightly different) new section length.
 */
export function preserveLocks(
  oldTimeline: MatchedSection[],
  newSections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
): LockPreserveResult {
  const lockQueue = oldTimeline.filter((s) => s.userLocked);
  const newTimeline: MatchedSection[] = [];
  let preservedCount = 0;

  for (let i = 0; i < newSections.length; i++) {
    const ns = newSections[i];
    const head = lockQueue[0];
    const tagMatch = head && head.tag.toLowerCase() === ns.tag.toLowerCase();
    const durOk =
      head && head.durationMs > 0
        ? Math.abs(ns.durationMs - head.durationMs) / head.durationMs <= DURATION_TOLERANCE
        : false;

    if (head && tagMatch && durOk) {
      // Consume the lock; recompute speedFactor for the new duration.
      // All real clips in a chain share one speedFactor, and by construction
      // sum(real-clip durations) === head.durationMs * speedFactor.
      lockQueue.shift();
      const realClips = head.clips.filter((c) => !c.isPlaceholder);
      const totalPickedMs =
        realClips.length > 0 ? head.durationMs * realClips[0].speedFactor : 0;
      const newSpeed =
        ns.durationMs > 0 && totalPickedMs > 0 ? totalPickedMs / ns.durationMs : 1;
      newTimeline.push({
        sectionIndex: i,
        tag: ns.tag,
        durationMs: ns.durationMs,
        clips: head.clips.map((c) => ({ ...c, speedFactor: c.isPlaceholder ? 1 : newSpeed })),
        warnings: [],
        userLocked: true,
      });
      preservedCount++;
    } else {
      // Fresh auto-match for this single section.
      const [matched] = matchSections([ns], clipsByBaseName);
      newTimeline.push({ ...matched, sectionIndex: i });
    }
  }

  return {
    newTimeline,
    preservedCount,
    droppedCount: lockQueue.length,
  };
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
pnpm test src/lib/__tests__/lock-preserve.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 3: Run typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/lock-preserve.ts src/lib/__tests__/lock-preserve.test.ts
git commit -m "feat(lock-preserve): pure diff for re-paste lock carry-over"
```

---

## Phase 2: Pure logic — playback plan + waveform helpers (TDD)

### Task 2.1: Write failing tests for `buildSectionPlaybackPlan`

**Files:**
- Create: `src/lib/__tests__/playback-plan.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// src/lib/__tests__/playback-plan.test.ts
import { describe, it, expect } from "vitest";
import { buildSectionPlaybackPlan } from "../playback-plan";
import type { MatchedSection } from "../auto-match";

const seg = (
  durationMs: number,
  speedFactor: number,
  isPlaceholder = false,
  i = 0,
) => ({
  clipId: `c${i}`,
  indexeddbKey: `k${i}`,
  speedFactor,
  isPlaceholder,
});

describe("buildSectionPlaybackPlan", () => {
  it("computes audioStartMs as the cumulative duration of preceding sections", () => {
    const timeline = [
      { sectionIndex: 0, tag: "a", durationMs: 5000, clips: [seg(5000, 1)], warnings: [] },
      { sectionIndex: 1, tag: "b", durationMs: 3000, clips: [seg(3000, 1)], warnings: [] },
      { sectionIndex: 2, tag: "c", durationMs: 4000, clips: [seg(4000, 1)], warnings: [] },
    ] as MatchedSection[];

    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"], ["k2", "blob:2"]]);

    const plan = buildSectionPlaybackPlan(timeline, 1, "blob:audio", blobs);

    expect(plan.audioStartMs).toBe(5000);
    expect(plan.audioUrl).toBe("blob:audio");
  });

  it("emits one entry per non-placeholder clip with the correct speedFactor", () => {
    const timeline = [
      {
        sectionIndex: 0,
        tag: "a",
        durationMs: 5000,
        clips: [seg(2500, 1.5, false, 0), seg(2500, 1.5, false, 1)],
        warnings: [],
      },
    ] as MatchedSection[];
    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"]]);

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);

    expect(plan.clips).toHaveLength(2);
    expect(plan.clips[0]).toMatchObject({ srcUrl: "blob:0", speedFactor: 1.5 });
    expect(plan.clips[1]).toMatchObject({ srcUrl: "blob:1", speedFactor: 1.5 });
  });

  it("produces an empty clips array when section is placeholder-only (renders black)", () => {
    const timeline = [
      { sectionIndex: 0, tag: "?", durationMs: 4000, clips: [seg(0, 1, true)], warnings: [] },
    ] as MatchedSection[];
    const blobs = new Map();
    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toEqual([]);
  });

  it("skips clips whose blob URL is missing (defensive — clip not loaded yet)", () => {
    const timeline = [
      {
        sectionIndex: 0,
        tag: "a",
        durationMs: 2000,
        clips: [seg(1000, 1, false, 0), seg(1000, 1, false, 1)],
        warnings: [],
      },
    ] as MatchedSection[];
    const blobs = new Map([["k0", "blob:0"]]); // k1 missing

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0].srcUrl).toBe("blob:0");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test src/lib/__tests__/playback-plan.test.ts
```

Expected: all tests fail with `Cannot find module '../playback-plan'`.

### Task 2.2: Implement `buildSectionPlaybackPlan`

**Files:**
- Create: `src/lib/playback-plan.ts`

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/playback-plan.ts
import type { MatchedSection } from "./auto-match";

export interface PlaybackPlanClip {
  srcUrl: string;     // ObjectURL for the clip blob
  startMs: number;    // start offset within the preview, in (real) ms
  endMs: number;      // end offset within the preview, in (real) ms
  speedFactor: number;
}

export interface PlaybackPlan {
  clips: PlaybackPlanClip[];
  audioUrl: string;
  audioStartMs: number;  // where in the master audio to seek when this plan starts
}

/**
 * Build a `PlaybackPlan` for a single section's chain.
 *
 * `audioStartMs` is the cumulative `durationMs` of all sections preceding `sectionIndex`,
 * so the master audio plays the matching range while the chain plays.
 *
 * `clips` is empty for placeholder-only sections (caller renders black + plays audio).
 * Clips whose `indexeddbKey` is not in `clipBlobUrls` are silently skipped (caller is
 * expected to pre-load all keys; missing entries fall through to no-op).
 *
 * V1 callers pass one section. V2 callers can extend this signature without breaking
 * the consumer interface.
 */
export function buildSectionPlaybackPlan(
  timeline: MatchedSection[],
  sectionIndex: number,
  audioUrl: string,
  clipBlobUrls: Map<string, string>,
): PlaybackPlan {
  const audioStartMs = timeline
    .slice(0, sectionIndex)
    .reduce((sum, s) => sum + s.durationMs, 0);

  const section = timeline[sectionIndex];
  if (!section) return { clips: [], audioUrl, audioStartMs };

  const real = section.clips.filter((c) => !c.isPlaceholder);
  if (real.length === 0) return { clips: [], audioUrl, audioStartMs };

  // Distribute the section duration evenly across the chain (current matcher contract:
  // chain shares one speedFactor; total clip durations / sectionMs == speedFactor).
  // For preview, we just emit each clip back-to-back at its speedFactor.
  const clips: PlaybackPlanClip[] = [];
  let cursor = 0;
  const slot = real.length === 0 ? 0 : section.durationMs / real.length;
  for (const c of real) {
    const url = clipBlobUrls.get(c.indexeddbKey);
    if (!url) continue;
    const startMs = cursor;
    const endMs = cursor + slot;
    clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor });
    cursor = endMs;
  }

  return { clips, audioUrl, audioStartMs };
}
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
pnpm test src/lib/__tests__/playback-plan.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/playback-plan.ts src/lib/__tests__/playback-plan.test.ts
git commit -m "feat(playback-plan): per-section plan builder for preview player"
```

### Task 2.3: Implement `computeWaveformPeaks`

**Files:**
- Create: `src/lib/waveform.ts`

This one is mostly a thin wrapper around `AudioContext.decodeAudioData`. We don't unit-test it (relies on browser globals); we'll exercise it manually when the audio track lands.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/waveform.ts

/**
 * Decode an audio file's bytes and downsample to `peakCount` peaks
 * (max-abs of each window). Returns Float32Array in [0, 1] range.
 *
 * Decoding is async and main-thread; for typical VSL audio (<10MB / <30 min)
 * this finishes in ~100ms on a modern machine. Caller decides cache strategy.
 */
export async function computeWaveformPeaks(
  audioBytes: ArrayBuffer,
  peakCount: number,
): Promise<Float32Array> {
  const Ctx: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    // decodeAudioData mutates the buffer in some browsers — copy first.
    const decoded = await ctx.decodeAudioData(audioBytes.slice(0));
    const channel = decoded.getChannelData(0);
    const windowSize = Math.max(1, Math.floor(channel.length / peakCount));
    const peaks = new Float32Array(peakCount);
    for (let i = 0; i < peakCount; i++) {
      let max = 0;
      const start = i * windowSize;
      const end = Math.min(start + windowSize, channel.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  } finally {
    void ctx.close();
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/waveform.ts
git commit -m "feat(waveform): decode audio + compute peaks for canvas track"
```

---

## Phase 3: Extend `BuildStateProvider`

### Task 3.1: Add editor state to context

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Replace the file with the extended version**

```tsx
// src/components/build/build-state-context.tsx
"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ParsedSection } from "@/lib/script-parser";
import type { MatchedSection } from "@/lib/auto-match";

interface BuildState {
  // Project inputs
  audioFile: File | null;
  audioDuration: number | null;
  setAudio: (file: File | null, duration: number | null) => void;
  scriptText: string;
  setScriptText: (t: string) => void;
  sections: ParsedSection[] | null;
  timeline: MatchedSection[] | null;
  setTimeline: (t: MatchedSection[]) => void;
  onParsed: (s: ParsedSection[], t: MatchedSection[]) => void;
  clearParsed: () => void;

  // Editor UI state
  selectedSectionIndex: number | null;
  setSelectedSectionIndex: (i: number | null) => void;
  playheadMs: number;
  setPlayheadMs: (ms: number) => void;
  audioDialogOpen: boolean;
  setAudioDialogOpen: (open: boolean) => void;
  scriptDialogOpen: boolean;
  setScriptDialogOpen: (open: boolean) => void;
  exportDialogOpen: boolean;
  setExportDialogOpen: (open: boolean) => void;

  // Derived
  inspectorMode: "section" | "empty";
  canExport: boolean;
}

const BuildStateContext = createContext<BuildState | null>(null);

export function BuildStateProvider({ children }: { children: React.ReactNode }) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [timeline, setTimeline] = useState<MatchedSection[] | null>(null);

  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  function setAudio(file: File | null, duration: number | null) {
    setAudioFile(file);
    setAudioDuration(duration);
  }

  function onParsed(s: ParsedSection[], t: MatchedSection[]) {
    setSections(s);
    setTimeline(t);
    setSelectedSectionIndex(null);
  }

  function clearParsed() {
    setSections(null);
    setTimeline(null);
    setSelectedSectionIndex(null);
  }

  const value = useMemo<BuildState>(() => {
    const inspectorMode: "section" | "empty" =
      selectedSectionIndex !== null && timeline ? "section" : "empty";
    const canExport =
      !!audioFile &&
      !!timeline &&
      timeline.length > 0 &&
      timeline.every((s) => s.clips.length > 0);
    return {
      audioFile,
      audioDuration,
      setAudio,
      scriptText,
      setScriptText,
      sections,
      timeline,
      setTimeline,
      onParsed,
      clearParsed,
      selectedSectionIndex,
      setSelectedSectionIndex,
      playheadMs,
      setPlayheadMs,
      audioDialogOpen,
      setAudioDialogOpen,
      scriptDialogOpen,
      setScriptDialogOpen,
      exportDialogOpen,
      setExportDialogOpen,
      inspectorMode,
      canExport,
    };
  }, [
    audioFile,
    audioDuration,
    scriptText,
    sections,
    timeline,
    selectedSectionIndex,
    playheadMs,
    audioDialogOpen,
    scriptDialogOpen,
    exportDialogOpen,
  ]);

  return <BuildStateContext.Provider value={value}>{children}</BuildStateContext.Provider>;
}

export function useBuildState() {
  const ctx = useContext(BuildStateContext);
  if (!ctx) throw new Error("useBuildState must be used within BuildStateProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify build still compiles**

```bash
pnpm typecheck
```

Expected: errors only at consumer sites that use the old API directly — none, since we extended (not removed) fields.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(state): extend BuildStateProvider with editor UI state"
```

---

## Phase 4: Editor shell + grid (no functional content yet)

### Task 4.1: Create the empty `EditorShell`

**Files:**
- Create: `src/components/editor/editor-shell.tsx`

The shell renders four placeholder boxes so we can verify grid math before plumbing real components.

- [ ] **Step 1: Write the shell**

```tsx
// src/components/editor/editor-shell.tsx
"use client";

interface EditorShellProps {
  productId: string;
}

export function EditorShell({ productId }: EditorShellProps) {
  return (
    <div
      className="grid h-[calc(100vh-4rem)] w-full bg-background text-foreground"
      style={{
        gridTemplateColumns: "320px 1fr 360px",
        gridTemplateRows: "48px 1fr 220px",
      }}
    >
      {/* Toolbar — spans all 3 cols */}
      <div className="col-span-3 row-start-1 flex items-center px-3 border-b border-border bg-muted/30 text-sm">
        <span className="text-muted-foreground">Toolbar (product: {productId})</span>
      </div>

      {/* Library */}
      <div className="row-start-2 col-start-1 border-r border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Library
      </div>

      {/* Preview */}
      <div className="row-start-2 col-start-2 overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-black/30">
        Preview
      </div>

      {/* Inspector */}
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Inspector
      </div>

      {/* Timeline — spans all 3 cols */}
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-muted/10">
        Timeline
      </div>
    </div>
  );
}
```

### Task 4.2: Drop the tab strip from the layout

**Files:**
- Modify: `src/app/dashboard/[productId]/layout.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// src/app/dashboard/[productId]/layout.tsx
"use client";

import { BuildStateProvider } from "@/components/build/build-state-context";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <BuildStateProvider>{children}</BuildStateProvider>;
}
```

### Task 4.3: Mount the shell on the workspace page

**Files:**
- Modify: `src/app/dashboard/[productId]/page.tsx`

We deliberately leave `/build/page.tsx` alive for now — last phase deletes it.

- [ ] **Step 1: Replace the file**

```tsx
// src/app/dashboard/[productId]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";

export default function WorkspacePage() {
  const { productId } = useParams<{ productId: string }>();
  return <EditorShell productId={productId} />;
}
```

- [ ] **Step 2: Run dev server and visually confirm**

```bash
pnpm dev
```

Open `http://localhost:3000/dashboard/<some-existing-product-id>`. Expected:
- 4 panels visible with placeholder labels
- No tab strip
- Layout takes full viewport height below the top app header
- No console errors

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/editor-shell.tsx src/app/dashboard/[productId]/layout.tsx src/app/dashboard/[productId]/page.tsx
git commit -m "feat(editor): mount empty shell + drop tab strip"
```

---

## Phase 5: Toolbar — pills + dialogs

### Task 5.1: Wrap `AudioUpload` in a dialog

**Files:**
- Create: `src/components/editor/dialogs/audio-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
// src/components/editor/dialogs/audio-dialog.tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AudioUpload } from "@/components/build/audio-upload";
import { useBuildState } from "@/components/build/build-state-context";

interface AudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AudioDialog({ open, onOpenChange }: AudioDialogProps) {
  const { audioFile, audioDuration, setAudio, sections, clearParsed } = useBuildState();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDuration, setPendingDuration] = useState<number | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  function handleFile(file: File | null, duration: number | null) {
    if (sections && audioFile && file && file !== audioFile) {
      // Replacing audio while sections exist → warn first.
      setPendingFile(file);
      setPendingDuration(duration);
      setConfirmReplace(true);
      return;
    }
    setAudio(file, duration);
    if (!file) clearParsed();
  }

  function confirmReplaceProceed() {
    setAudio(pendingFile, pendingDuration);
    clearParsed();
    setConfirmReplace(false);
    setPendingFile(null);
    setPendingDuration(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Audio</DialogTitle>
            <DialogDescription>
              Upload the master MP3. Total length determines the timeline.
            </DialogDescription>
          </DialogHeader>
          <AudioUpload file={audioFile} duration={audioDuration} onFile={handleFile} />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace audio?</DialogTitle>
            <DialogDescription>
              Sections exist for the current audio. Replacing will clear the parsed script
              and timeline — you'll need to re-paste the script.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReplace(false)}>Cancel</Button>
            <Button onClick={confirmReplaceProceed}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### Task 5.2: Wrap `ScriptPaste` in a dialog with lock-preservation save

**Files:**
- Create: `src/components/editor/dialogs/script-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
// src/components/editor/dialogs/script-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScriptPaste } from "@/components/build/script-paste";
import { useBuildState } from "@/components/build/build-state-context";
import { deriveBaseName } from "@/lib/broll";
import { buildClipsByBaseName, type ClipMetadata, type MatchedSection } from "@/lib/auto-match";
import { preserveLocks } from "@/lib/lock-preserve";
import type { ParsedSection } from "@/lib/script-parser";

interface ScriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
}

export function ScriptDialog({ open, onOpenChange, productId }: ScriptDialogProps) {
  const { scriptText, setScriptText, timeline, onParsed, setTimeline } = useBuildState();
  const [availableBaseNames, setAvailableBaseNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    fetch(`/api/products/${productId}/clips`)
      .then((r) => r.json())
      .then((clips: { brollName: string }[]) => {
        setAvailableBaseNames(new Set(clips.map((c) => deriveBaseName(c.brollName))));
      });
  }, [productId, open]);

  async function handleParsed(newSections: ParsedSection[], freshTimeline: MatchedSection[]) {
    // If there's no existing locked timeline, the fresh auto-match is the answer.
    const hasLocks = !!timeline && timeline.some((s) => s.userLocked);
    if (!hasLocks) {
      onParsed(newSections, freshTimeline);
      onOpenChange(false);
      return;
    }
    // Otherwise, preserve locks.
    const clipsRes = await fetch(`/api/products/${productId}/clips`);
    const rawClips = await clipsRes.json();
    const clips: ClipMetadata[] = rawClips.map(
      (c: Record<string, unknown>) =>
        ({
          ...(c as object),
          baseName: deriveBaseName(c.brollName as string),
          createdAt: new Date(c.createdAt as string),
        }) as ClipMetadata,
    );
    const map = buildClipsByBaseName(clips);
    const oldSnapshot = timeline!;
    const result = preserveLocks(timeline!, newSections, map);
    onParsed(newSections, result.newTimeline);

    toast.success(
      `${newSections.length} sections · ${result.preservedCount} locks preserved · ${result.droppedCount} dropped`,
      {
        action:
          result.preservedCount + result.droppedCount > 0
            ? { label: "Undo", onClick: () => setTimeline(oldSnapshot) }
            : undefined,
        duration: 30_000,
      },
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Script</DialogTitle>
          <DialogDescription>
            One line per section: <code>HH:MM:SS,mmm --&gt; HH:MM:SS,mmm || tag || text</code>
          </DialogDescription>
        </DialogHeader>
        <ScriptPaste
          text={scriptText}
          onTextChange={setScriptText}
          availableBaseNames={availableBaseNames}
          productId={productId}
          onParsed={handleParsed}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Task 5.3: Wrap `RenderTrigger` in a dialog

**Files:**
- Create: `src/components/editor/dialogs/export-dialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
// src/components/editor/dialogs/export-dialog.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RenderTrigger } from "@/components/build/render-trigger";
import { useBuildState } from "@/components/build/build-state-context";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const { audioFile, timeline } = useBuildState();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Renders the timeline + audio with FFmpeg.wasm and downloads an MP4.
          </DialogDescription>
        </DialogHeader>
        {audioFile && timeline ? (
          <RenderTrigger audioFile={audioFile} timeline={timeline} />
        ) : (
          <p className="text-sm text-muted-foreground">Audio + script required to export.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

### Task 5.4: Build the toolbar pills

**Files:**
- Create: `src/components/editor/toolbar/audio-pill.tsx`
- Create: `src/components/editor/toolbar/script-pill.tsx`
- Create: `src/components/editor/toolbar/export-button.tsx`

- [ ] **Step 1: AudioPill**

```tsx
// src/components/editor/toolbar/audio-pill.tsx
"use client";

import { Music } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPill() {
  const { audioFile, audioDuration, setAudioDialogOpen } = useBuildState();
  const ready = !!audioFile && audioDuration !== null;

  return (
    <button
      type="button"
      onClick={() => setAudioDialogOpen(true)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition",
        ready
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
          : "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <Music className="w-3 h-3" />
      {ready ? formatDuration(audioDuration!) : "Audio: not set"}
    </button>
  );
}
```

- [ ] **Step 2: ScriptPill**

```tsx
// src/components/editor/toolbar/script-pill.tsx
"use client";

import { FileText } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { cn } from "@/lib/utils";

export function ScriptPill() {
  const { sections, setScriptDialogOpen } = useBuildState();
  const ready = !!sections && sections.length > 0;

  return (
    <button
      type="button"
      onClick={() => setScriptDialogOpen(true)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition",
        ready
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
          : "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <FileText className="w-3 h-3" />
      {ready ? `${sections!.length} sections` : "Script: not set"}
    </button>
  );
}
```

- [ ] **Step 3: ExportButton**

```tsx
// src/components/editor/toolbar/export-button.tsx
"use client";

import { Play } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { Button } from "@/components/ui/button";

export function ExportButton() {
  const { canExport, setExportDialogOpen } = useBuildState();
  return (
    <Button
      size="sm"
      disabled={!canExport}
      onClick={() => setExportDialogOpen(true)}
    >
      <Play className="w-3.5 h-3.5 mr-1.5" />
      Export
    </Button>
  );
}
```

### Task 5.5: Wire toolbar into the shell + mount dialogs

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Update the shell**

```tsx
// src/components/editor/editor-shell.tsx
"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { AudioPill } from "./toolbar/audio-pill";
import { ScriptPill } from "./toolbar/script-pill";
import { ExportButton } from "./toolbar/export-button";
import { AudioDialog } from "./dialogs/audio-dialog";
import { ScriptDialog } from "./dialogs/script-dialog";
import { ExportDialog } from "./dialogs/export-dialog";

interface EditorShellProps {
  productId: string;
}

export function EditorShell({ productId }: EditorShellProps) {
  const {
    audioDialogOpen,
    setAudioDialogOpen,
    scriptDialogOpen,
    setScriptDialogOpen,
    exportDialogOpen,
    setExportDialogOpen,
  } = useBuildState();

  return (
    <div
      className="grid h-[calc(100vh-4rem)] w-full bg-background text-foreground"
      style={{
        gridTemplateColumns: "320px 1fr 360px",
        gridTemplateRows: "48px 1fr 220px",
      }}
    >
      <div className="col-span-3 row-start-1 flex items-center gap-3 px-3 border-b border-border bg-muted/30 text-sm">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground" aria-label="Back to projects">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <span className="text-muted-foreground/70 font-mono text-xs truncate max-w-[200px]">
          {productId}
        </span>
        <div className="flex items-center gap-2">
          <AudioPill />
          <ScriptPill />
        </div>
        <div className="ml-auto">
          <ExportButton />
        </div>
      </div>

      <div className="row-start-2 col-start-1 border-r border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Library
      </div>
      <div className="row-start-2 col-start-2 overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-black/30">
        Preview
      </div>
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Inspector
      </div>
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-muted/10">
        Timeline
      </div>

      <AudioDialog open={audioDialogOpen} onOpenChange={setAudioDialogOpen} />
      <ScriptDialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen} productId={productId} />
      <ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} />
    </div>
  );
}
```

- [ ] **Step 2: Run dev server and exercise the toolbar**

```bash
pnpm dev
```

Manual checks:
- Navigate to `/dashboard/<productId>`. Pills are amber ("Audio: not set", "Script: not set"). Export disabled.
- Click Audio pill → dialog opens → upload an MP3 → "Done". Pill turns green and shows duration.
- Click Script pill → dialog opens → paste valid script → "Parse Script" → onParsed fires → pill turns green with section count. Toast does NOT appear (no prior locks).
- Re-paste with at least one section locked (you'll be able to lock once Phase 7 is in; for now just verify the parse path works).
- No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/toolbar/ src/components/editor/dialogs/ src/components/editor/editor-shell.tsx
git commit -m "feat(editor): toolbar pills + audio/script/export dialogs"
```

---

## Phase 6: Library panel

### Task 6.1: Build the library panel

**Files:**
- Create: `src/components/editor/library/library-panel.tsx`

The panel reuses today's `FolderSidebar` and `ClipGrid`. We don't change those components — we just compose them.

- [ ] **Step 1: Write the panel**

```tsx
// src/components/editor/library/library-panel.tsx
"use client";

import { useEffect, useState } from "react";
import { FolderSidebar, type Folder } from "@/components/broll/folder-sidebar";
import { ClipGrid } from "@/components/broll/clip-grid";
import { filterClipsByQuery } from "@/lib/clip-filter";

type Clip = {
  id: string;
  brollName: string;
  filename: string;
  durationMs: number;
  indexeddbKey: string;
  folderId: string;
};

interface LibraryPanelProps {
  productId: string;
}

export function LibraryPanel({ productId }: LibraryPanelProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");

  function handleFileQueryChange(q: string) {
    setFileQuery(q);
    if (q.trim()) setActiveFolderId(null);
  }

  async function loadFolders() {
    const res = await fetch(`/api/products/${productId}/folders`);
    setFolders(await res.json());
  }
  async function loadAllClips() {
    const res = await fetch(`/api/products/${productId}/clips`);
    setClips(await res.json());
  }

  useEffect(() => {
    loadFolders();
    loadAllClips();
  }, [productId]);

  async function handleCreateFolder(name: string) {
    await fetch(`/api/products/${productId}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  }
  async function handleRenameFolder(id: string, name: string) {
    await fetch(`/api/products/${productId}/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  }
  async function handleDeleteFolder(id: string) {
    if (!confirm("Delete this folder and all its clips?")) return;
    const res = await fetch(`/api/products/${productId}/folders/${id}`, { method: "DELETE" });
    const { deletedClipIds } = await res.json();
    if (deletedClipIds?.length) {
      const { deleteProductClips } = await import("@/lib/clip-storage");
      await deleteProductClips(deletedClipIds);
    }
    if (activeFolderId === id) setActiveFolderId(null);
    await loadFolders();
    await loadAllClips();
  }

  const displayedClips = fileQuery.trim()
    ? filterClipsByQuery(clips, fileQuery)
    : activeFolderId
      ? clips.filter((c) => c.folderId === activeFolderId)
      : clips;

  return (
    <div className="flex h-full overflow-hidden">
      <FolderSidebar
        folders={folders}
        activeFolderId={activeFolderId}
        onSelect={setActiveFolderId}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onDelete={handleDeleteFolder}
        totalClipCount={clips.length}
      />
      <main className="flex-1 overflow-y-auto p-3 min-w-0">
        <ClipGrid
          clips={displayedClips}
          productId={productId}
          activeFolderId={activeFolderId}
          onClipsChanged={loadAllClips}
          fileQuery={fileQuery}
          onFileQueryChange={handleFileQueryChange}
        />
      </main>
    </div>
  );
}
```

### Task 6.2: Mount the library panel

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Replace the placeholder**

In `editor-shell.tsx`, find:

```tsx
      <div className="row-start-2 col-start-1 border-r border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Library
      </div>
```

Replace with:

```tsx
      <div className="row-start-2 col-start-1 border-r border-border overflow-hidden">
        <LibraryPanel productId={productId} />
      </div>
```

And add the import at the top:

```tsx
import { LibraryPanel } from "./library/library-panel";
```

- [ ] **Step 2: Run dev server and verify**

```bash
pnpm dev
```

- Library shows folders + clip grid in the 320px column.
- Folders on the left, grid on the right inside that column.
- If 320px is too tight (folder names truncate badly + grid feels squeezed), bump `gridTemplateColumns` to `"360px 1fr 360px"` in the shell. Verify by eye; commit either way.
- No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/library/ src/components/editor/editor-shell.tsx
git commit -m "feat(editor): mount library panel (folders + clip grid)"
```

---

## Phase 7: Inspector — extract section editor body

### Task 7.1: Refactor `SectionEditorDialog` body into `inspector-panel.tsx`

The existing `SectionEditorDialog` body (chain strip + variant grid + preview pane + footer with chain stats + save) becomes the inspector contents. We don't delete the dialog yet — Phase 11 does. For now, we duplicate the body into the inspector and have it read/write via context instead of via dialog props.

**Files:**
- Create: `src/components/editor/inspector/inspector-panel.tsx`
- Create: `src/components/editor/inspector/inspector-empty.tsx`

- [ ] **Step 1: Inspector empty state**

```tsx
// src/components/editor/inspector/inspector-empty.tsx
"use client";

import { useBuildState } from "@/components/build/build-state-context";

export function InspectorEmpty() {
  const { timeline } = useBuildState();
  if (!timeline) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Set audio + paste script to begin.
      </div>
    );
  }
  const totalSections = timeline.length;
  const matched = timeline.filter((s) => s.clips.every((c) => !c.isPlaceholder)).length;
  const locked = timeline.filter((s) => s.userLocked).length;
  const highSpeed = timeline.filter(
    (s) => s.clips.some((c) => c.speedFactor > 2.0),
  ).length;

  return (
    <div className="p-4 text-sm space-y-3">
      <p className="text-muted-foreground">Click a section in the timeline to edit it.</p>
      <ul className="text-xs space-y-1">
        <li><span className="font-mono">{matched}/{totalSections}</span> sections matched</li>
        <li><span className="font-mono">{locked}</span> locked</li>
        <li><span className="font-mono">{highSpeed}</span> high-speed warnings</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Inspector body (the section editor)**

```tsx
// src/components/editor/inspector/inspector-panel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChainStrip } from "@/components/build/section-editor/chain-strip";
import { VariantGrid } from "@/components/build/section-editor/variant-grid";
import { PreviewPane } from "@/components/build/section-editor/preview-pane";
import { useBuildState } from "@/components/build/build-state-context";
import { InspectorEmpty } from "./inspector-empty";
import { cn } from "@/lib/utils";
import { deriveBaseName } from "@/lib/broll";
import { formatMs } from "@/lib/format-time";
import {
  buildClipsByBaseName,
  buildManualChain,
  computeChainSpeed,
  HIGH_SPEED_THRESHOLD,
  matchSections,
  validateChain,
  type ClipMetadata,
  type MatchedClip,
} from "@/lib/auto-match";

interface InspectorPanelProps {
  productId: string;
}

export function InspectorPanel({ productId }: InspectorPanelProps) {
  const {
    inspectorMode,
    selectedSectionIndex,
    setSelectedSectionIndex,
    timeline,
    setTimeline,
  } = useBuildState();

  if (inspectorMode !== "section" || selectedSectionIndex === null || !timeline) {
    return <InspectorEmpty />;
  }

  return (
    <SectionEditor
      key={selectedSectionIndex}
      productId={productId}
      sectionIndex={selectedSectionIndex}
      onClose={() => setSelectedSectionIndex(null)}
      timeline={timeline}
      setTimeline={setTimeline}
    />
  );
}

function SectionEditor({
  productId,
  sectionIndex,
  onClose,
  timeline,
  setTimeline,
}: {
  productId: string;
  sectionIndex: number;
  onClose: () => void;
  timeline: ReturnType<typeof useBuildState>["timeline"];
  setTimeline: ReturnType<typeof useBuildState>["setTimeline"];
}) {
  const section = timeline![sectionIndex];

  const [variants, setVariants] = useState<ClipMetadata[]>([]);
  const [picks, setPicks] = useState<ClipMetadata[]>([]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [selectedClip, setSelectedClip] = useState<ClipMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/products/${productId}/clips`);
        if (!res.ok) throw new Error(`Failed to load clips (${res.status})`);
        const raw = (await res.json()) as Record<string, unknown>[];
        const all: ClipMetadata[] = raw.map(
          (c) =>
            ({
              ...(c as object),
              baseName: deriveBaseName(c.brollName as string),
              createdAt: new Date(c.createdAt as string),
            }) as ClipMetadata,
        );
        if (cancelled) return;
        const tag = section.tag.toLowerCase();
        setVariants(
          all.filter((c) => deriveBaseName(c.brollName) === tag).sort((a, b) => a.brollName.localeCompare(b.brollName)),
        );
        const byId = new Map(all.map((c) => [c.id, c]));
        setPicks(section.clips.filter((c) => !c.isPlaceholder).flatMap((c) => {
          const m = byId.get(c.clipId);
          return m ? [m] : [];
        }));
        setActiveSlot(null);
        setSelectedClip(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productId, sectionIndex, section.tag, section.clips]);

  const inChainIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
  const { speed, validation, isHighSpeed, totalMs } = useMemo(() => {
    const durs = picks.map((p) => p.durationMs);
    const s = computeChainSpeed(durs, section.durationMs);
    return {
      speed: s,
      validation: validateChain(durs, section.durationMs),
      isHighSpeed: s > HIGH_SPEED_THRESHOLD,
      totalMs: durs.reduce((a, d) => a + d, 0),
    };
  }, [picks, section.durationMs]);

  function handleSelectVariant(clip: ClipMetadata) {
    setSelectedClip(clip);
  }
  function handleUseInActiveSlot() {
    if (!selectedClip || activeSlot === null) return;
    if (activeSlot === picks.length) setPicks([...picks, selectedClip]);
    else setPicks(picks.map((p, i) => (i === activeSlot ? selectedClip : p)));
    setActiveSlot(null);
    setSelectedClip(null);
  }
  function handleRemoveSlot(slot: number) {
    setPicks(picks.filter((_, i) => i !== slot));
    if (activeSlot === slot) setActiveSlot(null);
    if (activeSlot !== null && activeSlot > slot) setActiveSlot(activeSlot - 1);
  }
  function handleSave() {
    if (validation && validation.code === "TOO_SLOW") return;
    const chain = buildManualChain(picks, section.durationMs);
    persistChain(chain, true);
  }
  async function handleResetAuto() {
    const res = await fetch(`/api/products/${productId}/clips`);
    const raw = (await res.json()) as Record<string, unknown>[];
    const all: ClipMetadata[] = raw.map(
      (c) =>
        ({
          ...(c as object),
          baseName: deriveBaseName(c.brollName as string),
          createdAt: new Date(c.createdAt as string),
        }) as ClipMetadata,
    );
    const map = buildClipsByBaseName(all);
    const fakeParsed = {
      lineNumber: sectionIndex + 1,
      startTime: 0,
      endTime: section.durationMs / 1000,
      tag: section.tag,
      scriptText: "",
      durationMs: section.durationMs,
    };
    const [rerolled] = matchSections([fakeParsed], map);
    persistChain(rerolled.clips, false);
  }
  function persistChain(clips: MatchedClip[], userLocked: boolean) {
    setTimeline(timeline!.map((s, i) => (i === sectionIndex ? { ...s, clips, userLocked } : s)));
  }

  const actionLabel =
    activeSlot === null
      ? "Select a slot first"
      : activeSlot === picks.length
        ? "Add to chain"
        : `Use for slot ${activeSlot + 1}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-sm font-medium truncate">
          [{section.tag}] · {formatMs(section.durationMs)}
          {section.userLocked && <span className="ml-2 text-blue-400 text-xs">🔒</span>}
        </div>
        <button onClick={onClose} aria-label="Close inspector" className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : loadError ? (
        <div className="p-4 text-sm text-red-500">{loadError}</div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <ChainStrip
            picks={picks}
            activeSlot={activeSlot}
            onActivateSlot={(s) => { setActiveSlot(s); setSelectedClip(picks[s] ?? null); }}
            onActivateAdd={() => { setActiveSlot(picks.length); setSelectedClip(null); }}
            onRemoveSlot={handleRemoveSlot}
          />

          <div className="flex-1 min-h-0 overflow-hidden grid grid-rows-[1fr_auto]">
            <div className="overflow-y-auto p-2">
              <VariantGrid
                variants={variants}
                selectedClipId={selectedClip?.id ?? null}
                onSelect={handleSelectVariant}
                inChainIds={inChainIds}
              />
            </div>
            <div className="border-t border-border p-2 max-h-[280px] overflow-y-auto">
              <PreviewPane
                clip={selectedClip}
                actionLabel={actionLabel}
                actionDisabled={!selectedClip || activeSlot === null}
                onUse={handleUseInActiveSlot}
              />
            </div>
          </div>

          <div className="border-t border-border px-3 py-2 space-y-2">
            <div className="text-xs">
              <span className="text-muted-foreground">Chain: </span>
              <span className="font-mono">{formatMs(totalMs)}</span>
              <span className="text-muted-foreground"> → </span>
              <span
                className={cn(
                  "font-mono",
                  isHighSpeed && "text-yellow-500",
                  validation?.code === "TOO_SLOW" && "text-red-500",
                )}
              >
                {speed.toFixed(2)}× speed
              </span>
              {validation?.code === "TOO_SLOW" && (
                <p className="text-red-500 text-[11px] mt-1">{validation.message}</p>
              )}
              {!validation && isHighSpeed && (
                <p className="text-yellow-500 text-[11px] mt-1">Speed &gt;2× — may distort.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleResetAuto} className="flex-1">
                Reset auto
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!!validation && validation.code === "TOO_SLOW"}
                className="flex-1"
              >
                Save lock
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Task 7.2: Mount the inspector

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Replace the inspector placeholder**

In `editor-shell.tsx`, find:

```tsx
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Inspector
      </div>
```

Replace with:

```tsx
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden">
        <InspectorPanel productId={productId} />
      </div>
```

Add the import:

```tsx
import { InspectorPanel } from "./inspector/inspector-panel";
```

- [ ] **Step 2: Smoke-test by setting `selectedSectionIndex` from devtools**

Inspector won't be reachable via clicks until Phase 8 wires the timeline. For now, verify the empty state renders. Open `http://localhost:3000/dashboard/<productId>`, set audio + paste script, and confirm the inspector shows "Click a section in the timeline to edit it" + the stats line.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/inspector/ src/components/editor/editor-shell.tsx
git commit -m "feat(editor): inspector panel with extracted section editor body"
```

---

## Phase 8: Timeline panel

### Task 8.1: Build the ruler

**Files:**
- Create: `src/components/editor/timeline/timeline-ruler.tsx`

- [ ] **Step 1: Write the ruler**

```tsx
// src/components/editor/timeline/timeline-ruler.tsx
"use client";

interface TimelineRulerProps {
  totalMs: number;
  pxPerSecond: number;
}

function formatTick(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TimelineRuler({ totalMs, pxPerSecond }: TimelineRulerProps) {
  const totalSec = totalMs / 1000;
  // Choose a tick spacing that gives ~60-100px between major ticks.
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120];
  const major = candidates.find((c) => c * pxPerSecond >= 60) ?? 60;
  const tickCount = Math.ceil(totalSec / major) + 1;

  return (
    <div className="relative h-5 border-b border-border text-[10px] text-muted-foreground select-none">
      {Array.from({ length: tickCount }, (_, i) => {
        const sec = i * major;
        const left = sec * pxPerSecond;
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-border/60 pl-1"
            style={{ left: `${left}px` }}
          >
            {formatTick(sec)}
          </div>
        );
      })}
    </div>
  );
}
```

### Task 8.2: Build the tags track

**Files:**
- Create: `src/components/editor/timeline/track-tags.tsx`

- [ ] **Step 1: Write the tags track**

```tsx
// src/components/editor/timeline/track-tags.tsx
"use client";

import { Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGH_SPEED_THRESHOLD, type MatchedSection } from "@/lib/auto-match";

interface TrackTagsProps {
  timeline: MatchedSection[];
  pxPerSecond: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function TrackTags({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackTagsProps) {
  let cursor = 0;
  return (
    <div className="relative h-10 flex items-stretch">
      {timeline.map((s, i) => {
        const left = cursor;
        const width = (s.durationMs / 1000) * pxPerSecond;
        cursor += width;
        const isMissing = s.clips.some((c) => c.isPlaceholder);
        const isHighSpeed =
          s.clips.length > 0 && Math.max(...s.clips.map((c) => c.speedFactor)) > HIGH_SPEED_THRESHOLD;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "absolute top-1 bottom-1 px-1.5 rounded-sm border text-[10px] font-medium truncate flex items-center gap-1 transition",
              isMissing && "bg-red-500/10 border-red-500/40 border-dashed text-red-300",
              !isMissing && s.userLocked && "bg-blue-500/15 border-blue-500/50 text-blue-200",
              !isMissing && !s.userLocked && isHighSpeed && "bg-yellow-500/15 border-yellow-500/50 text-yellow-200",
              !isMissing && !s.userLocked && !isHighSpeed && "bg-primary/15 border-primary/40 text-primary",
              i === selectedIndex && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
            title={`[${s.tag}] ${s.durationMs}ms`}
          >
            <span className="truncate">{s.tag}</span>
            {s.userLocked && <Lock className="w-2.5 h-2.5 shrink-0" />}
            {isHighSpeed && <AlertTriangle className="w-2.5 h-2.5 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
```

### Task 8.3: Build the clips track

**Files:**
- Create: `src/components/editor/timeline/track-clips.tsx`

- [ ] **Step 1: Write the clips track**

```tsx
// src/components/editor/timeline/track-clips.tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
import type { MatchedSection } from "@/lib/auto-match";

interface TrackClipsProps {
  timeline: MatchedSection[];
  pxPerSecond: number;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function TrackClips({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackClipsProps) {
  let cursor = 0;
  return (
    <div className="relative h-[90px] flex items-stretch bg-muted/10">
      {timeline.map((section, i) => {
        const left = cursor;
        const width = (section.durationMs / 1000) * pxPerSecond;
        cursor += width;
        return (
          <div
            key={i}
            onClick={() => onSelect(i)}
            className={cn(
              "absolute top-1 bottom-1 rounded-sm border overflow-hidden flex gap-px cursor-pointer",
              section.userLocked ? "border-blue-500/50" : "border-border/50",
              section.clips.some((c) => c.isPlaceholder) && "border-red-500/40 border-dashed bg-red-500/5",
              i === selectedIndex && "ring-2 ring-primary ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
          >
            {section.clips.map((c, j) =>
              c.isPlaceholder ? (
                <div key={j} className="flex-1 min-w-0 flex items-center justify-center text-red-400 text-xs">▣</div>
              ) : (
                <ClipThumb key={j} clipId={c.clipId} speedFactor={c.speedFactor} />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClipThumb({ clipId, speedFactor }: { clipId: string; speedFactor: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let active = true;
    getThumbnail(clipId).then((buf) => {
      if (!active || !buf) return;
      url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      setSrc(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [clipId]);
  return (
    <div className="relative flex-1 min-w-0 bg-black/40">
      {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {speedFactor !== 1 && (
        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1">
          {speedFactor.toFixed(1)}×
        </span>
      )}
    </div>
  );
}
```

### Task 8.4: Build the audio waveform track

**Files:**
- Create: `src/components/editor/timeline/track-audio.tsx`

- [ ] **Step 1: Write the audio track**

```tsx
// src/components/editor/timeline/track-audio.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { computeWaveformPeaks } from "@/lib/waveform";

interface TrackAudioProps {
  audioFile: File | null;
  audioDuration: number | null;
  pxPerSecond: number;
}

export function TrackAudio({ audioFile, audioDuration, pxPerSecond }: TrackAudioProps) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Decode peaks once per audio file (peakCount fixed; we resample at render time).
  useEffect(() => {
    if (!audioFile) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    audioFile.arrayBuffer().then((buf) => {
      if (cancelled) return;
      computeWaveformPeaks(buf, 4000).then((p) => {
        if (!cancelled) setPeaks(p);
      });
    });
    return () => { cancelled = true; };
  }, [audioFile]);

  // Draw canvas whenever peaks or zoom change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !audioDuration) return;
    const widthPx = Math.max(1, Math.floor(audioDuration * pxPerSecond));
    const heightPx = 50;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthPx * dpr;
    canvas.height = heightPx * dpr;
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = "rgba(96, 165, 250, 0.6)";
    const mid = heightPx / 2;
    for (let x = 0; x < widthPx; x++) {
      const t = x / widthPx;
      const idx = Math.floor(t * peaks.length);
      const v = peaks[idx] ?? 0;
      const h = Math.max(1, v * (heightPx - 4));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, audioDuration, pxPerSecond]);

  if (!audioFile || !audioDuration) {
    return (
      <div className="h-[50px] bg-muted/10 flex items-center px-3 text-xs text-muted-foreground">
        No audio loaded
      </div>
    );
  }

  return (
    <div className="h-[50px] bg-muted/5 overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
```

### Task 8.5: Compose `TimelinePanel`

**Files:**
- Create: `src/components/editor/timeline/timeline-panel.tsx`

- [ ] **Step 1: Write the panel**

```tsx
// src/components/editor/timeline/timeline-panel.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { TimelineRuler } from "./timeline-ruler";
import { TrackTags } from "./track-tags";
import { TrackClips } from "./track-clips";
import { TrackAudio } from "./track-audio";

const MIN_PX_PER_SEC = 5;
const MAX_PX_PER_SEC = 200;

export function TimelinePanel() {
  const {
    timeline,
    audioFile,
    audioDuration,
    selectedSectionIndex,
    setSelectedSectionIndex,
    playheadMs,
  } = useBuildState();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [pxPerSec, setPxPerSec] = useState<number | null>(null);

  // Default zoom = fit total duration into roughly the viewport width.
  const totalMs = useMemo(() => {
    if (timeline) return timeline.reduce((sum, s) => sum + s.durationMs, 0);
    if (audioDuration) return audioDuration * 1000;
    return 0;
  }, [timeline, audioDuration]);

  const effectivePxPerSec = pxPerSec ?? (() => {
    if (totalMs <= 0) return 30;
    const viewport = scrollerRef.current?.clientWidth ?? 800;
    return Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, viewport / (totalMs / 1000)));
  })();

  function zoom(delta: number) {
    setPxPerSec((curr) => {
      const base = curr ?? effectivePxPerSec;
      return Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, base * delta));
    });
  }

  if (!audioFile) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Set audio in the toolbar to begin.
      </div>
    );
  }

  const playheadLeft = (playheadMs / 1000) * effectivePxPerSec;
  const totalWidthPx = (totalMs / 1000) * effectivePxPerSec;

  return (
    <div className="h-full flex flex-col">
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

      <div ref={scrollerRef} className="relative flex-1 overflow-x-auto overflow-y-hidden">
        <div style={{ width: `${Math.max(totalWidthPx, 1)}px` }} className="relative">
          <TimelineRuler totalMs={totalMs} pxPerSecond={effectivePxPerSec} />
          {timeline ? (
            <>
              <TrackTags
                timeline={timeline}
                pxPerSecond={effectivePxPerSec}
                selectedIndex={selectedSectionIndex}
                onSelect={setSelectedSectionIndex}
              />
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
          <TrackAudio audioFile={audioFile} audioDuration={audioDuration} pxPerSecond={effectivePxPerSec} />

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-orange-400 shadow-[0_0_4px_rgba(251,146,60,0.8)]"
            style={{ left: `${playheadLeft}px` }}
          />
        </div>
      </div>
    </div>
  );
}
```

### Task 8.6: Mount the timeline panel

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Replace the placeholder**

Find:

```tsx
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-muted/10">
        Timeline
      </div>
```

Replace:

```tsx
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden">
        <TimelinePanel />
      </div>
```

Add the import:

```tsx
import { TimelinePanel } from "./timeline/timeline-panel";
```

- [ ] **Step 2: Manual smoke test**

```bash
pnpm dev
```

- Set audio + paste script. Three tracks render: tag pills, clip thumbnails, waveform.
- Zoom + / − changes scale; horizontal scroll shows the full timeline.
- Click a tag or clip block → inspector switches to section editor mode.
- Locked / high-speed / missing borders render correctly.
- No console errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/timeline/ src/components/editor/editor-shell.tsx
git commit -m "feat(editor): 3-track timeline panel + zoom + section selection"
```

---

## Phase 9: Preview player (per-section, B-ready)

### Task 9.1: Build the preview player

**Files:**
- Create: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Write the player**

```tsx
// src/components/editor/preview/preview-player.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { getClip } from "@/lib/clip-storage";
import { buildSectionPlaybackPlan, type PlaybackPlan } from "@/lib/playback-plan";
import { formatMs } from "@/lib/format-time";

export function PreviewPlayer() {
  const {
    audioFile,
    timeline,
    selectedSectionIndex,
    setPlayheadMs,
  } = useBuildState();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipUrls, setClipUrls] = useState<Map<string, string>>(new Map());
  const [chainIdx, setChainIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Build object URL for the audio file.
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Pre-fetch clip blobs for the selected section's chain.
  useEffect(() => {
    if (!timeline || selectedSectionIndex === null) return;
    const section = timeline[selectedSectionIndex];
    if (!section) return;
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const map = new Map<string, string>();
      for (const c of section.clips) {
        if (c.isPlaceholder) continue;
        if (clipUrls.has(c.indexeddbKey)) {
          map.set(c.indexeddbKey, clipUrls.get(c.indexeddbKey)!);
          continue;
        }
        const buf = await getClip(c.indexeddbKey);
        if (cancelled || !buf) continue;
        const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
        created.push(url);
        map.set(c.indexeddbKey, url);
      }
      if (!cancelled) setClipUrls((prev) => new Map([...prev, ...map]));
    })();
    return () => { cancelled = true; created.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, selectedSectionIndex]);

  const plan: PlaybackPlan | null = useMemo(() => {
    if (!timeline || selectedSectionIndex === null || !audioUrl) return null;
    return buildSectionPlaybackPlan(timeline, selectedSectionIndex, audioUrl, clipUrls);
  }, [timeline, selectedSectionIndex, audioUrl, clipUrls]);

  // Whenever the plan changes (new section selected) reset chain index + seek audio.
  useEffect(() => {
    if (!plan) return;
    setChainIdx(0);
    setPlaying(false);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = plan.audioStartMs / 1000;
      audio.pause();
    }
  }, [plan]);

  // When chain advances, swap video src.
  useEffect(() => {
    if (!plan || plan.clips.length === 0) return;
    const video = videoRef.current;
    if (!video) return;
    const clip = plan.clips[chainIdx];
    if (!clip) return;
    video.src = clip.srcUrl;
    video.playbackRate = clip.speedFactor;
    if (playing) void video.play();
  }, [plan, chainIdx, playing]);

  // Drive playhead from audio time when playing.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !plan) return;
    const handler = () => {
      setPlayheadMs(audio.currentTime * 1000);
    };
    audio.addEventListener("timeupdate", handler);
    return () => audio.removeEventListener("timeupdate", handler);
  }, [plan, setPlayheadMs]);

  // Advance chain on video end.
  function handleVideoEnded() {
    if (!plan) return;
    if (chainIdx < plan.clips.length - 1) {
      setChainIdx(chainIdx + 1);
    } else {
      // Chain finished — pause everything.
      const audio = audioRef.current;
      audio?.pause();
      setPlaying(false);
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;
    if (playing) {
      audio.pause();
      video.pause();
      setPlaying(false);
    } else {
      void audio.play();
      void video.play();
      setPlaying(true);
    }
  }

  if (!timeline || selectedSectionIndex === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Select a section in the timeline to preview.
      </div>
    );
  }

  const section = timeline[selectedSectionIndex];
  const aspectRatio = "9 / 16";

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-3">
      <div
        className="bg-black rounded overflow-hidden flex items-center justify-center"
        style={{ aspectRatio, height: "calc(100% - 48px)", maxWidth: "100%" }}
      >
        {plan && plan.clips.length > 0 ? (
          <video
            ref={videoRef}
            playsInline
            muted
            onEnded={handleVideoEnded}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-xs text-muted-foreground">Black frame (no clip for [{section.tag}])</div>
        )}
      </div>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <span className="font-mono">{formatMs(section.durationMs)}</span>
        <span>· [{section.tag}]</span>
      </div>
    </div>
  );
}
```

### Task 9.2: Mount the preview player

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Replace the placeholder**

Find:

```tsx
      <div className="row-start-2 col-start-2 overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-black/30">
        Preview
      </div>
```

Replace:

```tsx
      <div className="row-start-2 col-start-2 overflow-hidden bg-black/30">
        <PreviewPlayer />
      </div>
```

Add import:

```tsx
import { PreviewPlayer } from "./preview/preview-player";
```

- [ ] **Step 2: Manual smoke test**

```bash
pnpm dev
```

- Set audio + paste script. Click any matched section in the timeline.
- Preview shows the chain's first video. Press play → video plays at the section's `speedFactor`, audio plays from that section's start. When the video ends, next clip in chain takes over (if multi-clip). When chain ends, both pause.
- Pause button stops both. Selecting a different section resets the player.
- Section with placeholder (missing tag) shows "Black frame" + still plays audio.

Expected behavior gaps (acceptable for v1):
- No scrubbing — only play/pause + section-click seek.
- Audio briefly desynchronizes by ≤50ms across multi-clip chain swaps. v2 fixes.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/preview/ src/components/editor/editor-shell.tsx
git commit -m "feat(editor): per-section preview player driven by PlaybackPlan"
```

---

## Phase 10: Final cleanup

### Task 10.1: Delete `/build` route

**Files:**
- Delete: `src/app/dashboard/[productId]/build/page.tsx`

- [ ] **Step 1: Remove the file**

```bash
git rm src/app/dashboard/[productId]/build/page.tsx
rmdir src/app/dashboard/[productId]/build
```

- [ ] **Step 2: Verify no inbound links**

```bash
grep -r '/build' src/ --include='*.tsx' --include='*.ts' || true
```

Expected: only references inside the editor (e.g., `src/components/build/...` paths). If any `Link href="...build"` remains, remove it.

### Task 10.2: Delete `SectionEditorDialog` and legacy timeline preview

**Files:**
- Delete: `src/components/build/section-editor/section-editor-dialog.tsx`
- Delete: `src/components/build/timeline-preview.tsx`
- Delete: `src/components/build/step-wrapper.tsx`

- [ ] **Step 1: Verify no remaining importers**

```bash
grep -r 'section-editor-dialog\|timeline-preview\|step-wrapper' src/ --include='*.tsx' --include='*.ts'
```

Expected: no matches. (If any: investigate before deleting.)

- [ ] **Step 2: Remove the files**

```bash
git rm src/components/build/section-editor/section-editor-dialog.tsx \
       src/components/build/timeline-preview.tsx \
       src/components/build/step-wrapper.tsx
```

- [ ] **Step 3: Run typecheck + tests + lint**

```bash
pnpm check && pnpm test
```

Expected: all green. If any errors, fix imports left dangling.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(editor): remove /build route and legacy wizard components"
```

### Task 10.3: Final manual acceptance pass

- [ ] **Step 1: Walk the acceptance bar from the spec**

Run `pnpm dev` and verify each:

1. Open `/dashboard/<productId>` — editor shell renders, pills are amber.
2. Click 🎵 Audio pill → upload MP3 → pill turns green with duration.
3. Click 📝 Script pill → paste valid script → "Parse Script" → pill turns green with section count. Timeline tags + clips populate. Audio waveform draws.
4. Click any matched section in the timeline → inspector opens with chain strip + variants. Preview shows first frame of section's chain.
5. In inspector: pick a different variant → "Use for slot 1" → Save lock. Tag pill in timeline gains 🔒. Section card gets blue ring.
6. Press play in preview → video plays at speedFactor; audio plays from section start; multi-clip chains advance; chain end pauses.
7. Re-open Script dialog, edit text slightly (typo fix), parse again → toast appears: "N sections · X locks preserved · Y dropped" with Undo. Click Undo → previous timeline restored.
8. Click [▶ Export] → ExportDialog opens, RenderTrigger renders engine loads, click Render → MP4 downloads.

If all 8 pass: v1 is done.

- [ ] **Step 2: If anything fails, file follow-up tasks; otherwise tag the commit**

```bash
git tag editor-v1
```

---

## Self-review checklist

Before opening a PR or handing off, run:

```bash
pnpm check   # lint + typecheck
pnpm test    # vitest
```

Both must be green. The acceptance walk in Task 10.3 must succeed end-to-end.

## Spec coverage cross-check

| Spec section | Covered by task |
|---|---|
| Routing & file structure | 4.2, 4.3, 10.1 |
| Page shell — CSS grid | 4.1, 5.5 |
| State (extends `BuildStateProvider`) | 3.1 |
| Top toolbar | 5.1–5.5 |
| Library panel | 6.1, 6.2 |
| Preview player (v1, B-ready API) | 2.2, 9.1, 9.2 |
| Timeline (3 tracks, ruler, zoom, playhead) | 8.1–8.6 |
| Inspector | 7.1, 7.2 |
| Lock preservation | 1.1, 1.2, 5.2 |
| Edge & error states (audio replace, no audio, no script, placeholder, too-slow chain) | 5.1, 5.5, 7.1, 8.5, 8.6, 9.1 |
| Testing strategy (lock-preserve, playback-plan unit) | 1.1, 1.2, 2.1, 2.2 |
| Out of scope (continuous playback, drag, persistence, captions, multi-audio) | n/a — explicitly not implemented |
| Acceptance bar | 10.3 |
