# Continuous Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Preview play the entire timeline end-to-end (audio + auto-swap b-roll) so the user can review the full edit and spot bad/over-sped clips, instead of only previewing one selected section at a time.

**Architecture:** Audio is the master clock. A new pure builder produces a `PlaybackPlan` with absolute `startMs`/`endMs` for **every** clip across the whole timeline. The player drives swap detection from `audioRef.currentTime` via a `requestAnimationFrame` loop (more responsive than `timeupdate`'s ~4Hz). Clicking anywhere on the timeline ruler/audio track seeks the audio; the player re-derives which clip should be on screen and seeks within it. Selected-section follows the playhead automatically.

**Tech Stack:** React 19 hooks, HTML5 `<video>` + `<audio>`, `requestAnimationFrame`, Vitest.

**Spec source:** `docs/superpowers/specs/2026-04-26-capcut-editor-design.md` § "v2-ready API" — this plan implements the v2 promise.

---

## File map

**New / extended:**

| Path | Responsibility |
|---|---|
| `src/lib/playback-plan.ts` | Add `buildFullTimelinePlaybackPlan` and `findClipAtMs` / `findSectionAtMs` helpers next to existing `buildSectionPlaybackPlan`. |
| `src/lib/__tests__/playback-plan.test.ts` | Add cases for the full-timeline builder + lookup helpers. |
| `src/components/build/build-state-context.tsx` | Add `playerSeekRef: RefObject<((ms: number) => void) \| null>` so non-player components (timeline) can seek without prop drilling. |
| `src/components/editor/preview/preview-player.tsx` | Rewrite: full-timeline plan, eager pre-fetch of all clip blobs, rAF loop driving swap from audio time, auto-update `selectedSectionIndex`, register `playerSeekRef`. |
| `src/components/editor/timeline/timeline-panel.tsx` | Click on the inner scroller (ruler / audio area) → call `playerSeekRef.current(ms)`. |

**Unchanged:** Inspector, library, all section-editor pieces. Selecting a section still works (but now the selection is also auto-driven by the playhead).

---

## Phase 1 — Pure helpers (TDD)

### Task 1.1: Tests for `buildFullTimelinePlaybackPlan`

**Files:**
- Modify: `src/lib/__tests__/playback-plan.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// at end of src/lib/__tests__/playback-plan.test.ts
import { buildFullTimelinePlaybackPlan } from "../playback-plan";
import type { MatchedSection } from "../auto-match";

function s(durationMs: number, clips: { key: string; speed: number; placeholder?: boolean }[]): MatchedSection {
  return {
    tag: "x",
    durationMs,
    userLocked: false,
    clips: clips.map((c) => ({
      clipId: `id-${c.key}`,
      indexeddbKey: c.key,
      speedFactor: c.speed,
      isPlaceholder: !!c.placeholder,
    })),
  };
}

describe("buildFullTimelinePlaybackPlan", () => {
  it("returns empty clips when timeline is empty", () => {
    const plan = buildFullTimelinePlaybackPlan([], "audio.mp3", new Map());
    expect(plan.clips).toEqual([]);
    expect(plan.audioUrl).toBe("audio.mp3");
  });

  it("emits one clip per real chain entry with absolute start/end across sections", () => {
    const timeline = [
      s(2000, [{ key: "a", speed: 1 }]),
      s(3000, [{ key: "b", speed: 2 }, { key: "c", speed: 1.5 }]),
    ];
    const urls = new Map([
      ["a", "blob:a"],
      ["b", "blob:b"],
      ["c", "blob:c"],
    ]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0, endMs: 2000, speedFactor: 1 },
      { srcUrl: "blob:b", startMs: 2000, endMs: 3500, speedFactor: 2 },
      { srcUrl: "blob:c", startMs: 3500, endMs: 5000, speedFactor: 1.5 },
    ]);
  });

  it("skips placeholder-only sections but advances the cursor", () => {
    const timeline = [
      s(1000, [{ key: "a", speed: 1 }]),
      s(2000, [{ key: "_", speed: 1, placeholder: true }]),
      s(1000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1 },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1 },
    ]);
  });

  it("skips a real clip whose blob URL is missing but keeps later clips aligned", () => {
    const timeline = [
      s(1000, [{ key: "a", speed: 1 }]),
      s(2000, [{ key: "missing", speed: 1 }]),
      s(1000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1 },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: 4 new failures with `buildFullTimelinePlaybackPlan is not a function`.

### Task 1.2: Implement `buildFullTimelinePlaybackPlan`

**Files:**
- Modify: `src/lib/playback-plan.ts`

- [ ] **Step 1: Add the function**

Append to `src/lib/playback-plan.ts`:

```ts
/**
 * Builds a playback plan that spans the entire timeline. Clips are emitted in
 * play order with absolute `startMs`/`endMs` measured from the start of the
 * master audio. Placeholders and clips with missing blob URLs are skipped, but
 * the time cursor still advances so subsequent clips stay aligned with the
 * audio (the player renders black during the gap).
 */
export function buildFullTimelinePlaybackPlan(
  timeline: MatchedSection[],
  audioUrl: string,
  clipBlobUrls: Map<string, string>,
): PlaybackPlan {
  const clips: PlaybackPlanClip[] = [];
  let cursor = 0;
  for (const section of timeline) {
    const real = section.clips.filter((c) => !c.isPlaceholder);
    if (real.length === 0) {
      cursor += section.durationMs;
      continue;
    }
    const slot = section.durationMs / real.length;
    for (const c of real) {
      const startMs = cursor;
      const endMs = cursor + slot;
      cursor = endMs;
      const url = clipBlobUrls.get(c.indexeddbKey);
      if (!url) continue;
      clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor });
    }
  }
  return { clips, audioUrl, audioStartMs: 0 };
}
```

- [ ] **Step 2: Run to confirm GREEN**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/playback-plan.ts src/lib/__tests__/playback-plan.test.ts
git commit -m "feat(playback-plan): add buildFullTimelinePlaybackPlan for end-to-end preview"
```

### Task 1.3: Tests for `findClipAtMs` and `findSectionAtMs`

**Files:**
- Modify: `src/lib/__tests__/playback-plan.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// at end of the same test file
import { findClipAtMs, findSectionAtMs } from "../playback-plan";

describe("findClipAtMs", () => {
  const clips = [
    { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1 },
    { srcUrl: "blob:b", startMs: 1000, endMs: 2500, speedFactor: 1.5 },
    { srcUrl: "blob:c", startMs: 2500, endMs: 4000, speedFactor: 1 },
  ];

  it("returns the clip whose half-open range [start, end) contains the ms", () => {
    expect(findClipAtMs(clips, 0)?.srcUrl).toBe("blob:a");
    expect(findClipAtMs(clips, 999)?.srcUrl).toBe("blob:a");
    expect(findClipAtMs(clips, 1000)?.srcUrl).toBe("blob:b");
    expect(findClipAtMs(clips, 2499)?.srcUrl).toBe("blob:b");
    expect(findClipAtMs(clips, 2500)?.srcUrl).toBe("blob:c");
  });

  it("returns null past the last clip's end", () => {
    expect(findClipAtMs(clips, 4000)).toBeNull();
    expect(findClipAtMs(clips, 9999)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findClipAtMs([], 100)).toBeNull();
  });
});

describe("findSectionAtMs", () => {
  const timeline = [s(1000, []), s(2000, []), s(500, [])];

  it("maps an audio time to its containing section index", () => {
    expect(findSectionAtMs(timeline, 0)).toBe(0);
    expect(findSectionAtMs(timeline, 999)).toBe(0);
    expect(findSectionAtMs(timeline, 1000)).toBe(1);
    expect(findSectionAtMs(timeline, 2999)).toBe(1);
    expect(findSectionAtMs(timeline, 3000)).toBe(2);
    expect(findSectionAtMs(timeline, 3499)).toBe(2);
  });

  it("returns null past the timeline's total duration", () => {
    expect(findSectionAtMs(timeline, 3500)).toBeNull();
    expect(findSectionAtMs(timeline, 9999)).toBeNull();
  });

  it("returns null on empty timeline", () => {
    expect(findSectionAtMs([], 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: failures with `findClipAtMs is not a function` / `findSectionAtMs is not a function`.

### Task 1.4: Implement lookup helpers

**Files:**
- Modify: `src/lib/playback-plan.ts`

- [ ] **Step 1: Add the helpers**

Append to `src/lib/playback-plan.ts`:

```ts
/**
 * Returns the clip whose half-open time range [startMs, endMs) contains ms,
 * or null when ms falls in a gap (placeholder or missing-blob slot) or past
 * the last clip. Linear scan — clip count per timeline is small (< 50).
 */
export function findClipAtMs(clips: PlaybackPlanClip[], ms: number): PlaybackPlanClip | null {
  for (const c of clips) {
    if (ms >= c.startMs && ms < c.endMs) return c;
  }
  return null;
}

/**
 * Returns the section index whose cumulative duration window contains ms.
 * Used to keep `selectedSectionIndex` synchronized with the playhead so the
 * Inspector follows along during playback.
 */
export function findSectionAtMs(timeline: MatchedSection[], ms: number): number | null {
  let cursor = 0;
  for (let i = 0; i < timeline.length; i++) {
    const sectionMs = timeline[i]!.durationMs;
    if (ms >= cursor && ms < cursor + sectionMs) return i;
    cursor += sectionMs;
  }
  return null;
}
```

- [ ] **Step 2: Run to confirm GREEN**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/playback-plan.ts src/lib/__tests__/playback-plan.test.ts
git commit -m "feat(playback-plan): add findClipAtMs and findSectionAtMs lookup helpers"
```

---

## Phase 2 — Player rewrite

### Task 2.1: Add `playerSeekRef` to context

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Extend the interface and provider**

Open `src/components/build/build-state-context.tsx`. Add to the imports:

```ts
import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
```

Add to the `BuildState` interface, anywhere near the other UI fields:

```ts
  // Imperative seek handle. Player registers a setter on mount; timeline calls
  // it to drive audio.currentTime without a useEffect feedback loop.
  playerSeekRef: MutableRefObject<((ms: number) => void) | null>;
```

Inside `BuildStateProvider`, near the other `useState` lines:

```ts
  const playerSeekRef = useRef<((ms: number) => void) | null>(null);
```

Add `playerSeekRef` to the value object returned by `useMemo` (do NOT add it to the dependency array — it's a stable ref, never changes identity).

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck 2>&1 | grep build-state-context | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(build-state): expose playerSeekRef so timeline can seek the player"
```

### Task 2.2: Rewrite `preview-player.tsx` for continuous playback

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx` (full rewrite)

- [ ] **Step 1: Replace the file**

Overwrite `src/components/editor/preview/preview-player.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { getClip } from "@/lib/clip-storage";
import {
  buildFullTimelinePlaybackPlan,
  findClipAtMs,
  findSectionAtMs,
  type PlaybackPlanClip,
} from "@/lib/playback-plan";
import { formatMs } from "@/lib/format-time";

export function PreviewPlayer() {
  const {
    audioFile,
    timeline,
    selectedSectionIndex,
    setSelectedSectionIndex,
    setPlayheadMs,
    playerSeekRef,
  } = useBuildState();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipUrls, setClipUrls] = useState<Map<string, string>>(new Map());
  const clipUrlsRef = useRef<Map<string, string>>(new Map());
  const [playing, setPlaying] = useState(false);
  const currentClipRef = useRef<PlaybackPlanClip | null>(null);
  const selectedSectionRef = useRef<number | null>(selectedSectionIndex);
  selectedSectionRef.current = selectedSectionIndex;

  // Audio object URL.
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Revoke clip blob URLs only on full unmount.
  useEffect(() => {
    const ref = clipUrlsRef;
    return () => {
      ref.current.forEach((u) => URL.revokeObjectURL(u));
      ref.current.clear();
    };
  }, []);

  // Eager pre-fetch every real clip the moment timeline is set so playback
  // never stalls on an IndexedDB read mid-scrub.
  useEffect(() => {
    if (!timeline) return;
    let cancelled = false;
    (async () => {
      const additions = new Map<string, string>();
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
  }, [timeline]);

  const plan = useMemo(() => {
    if (!timeline || !audioUrl) return null;
    return buildFullTimelinePlaybackPlan(timeline, audioUrl, clipUrls);
  }, [timeline, audioUrl, clipUrls]);

  // Imperatively swap <video> src to the clip that should be on screen at
  // audioMs. Idempotent — bails when the same clip is already loaded so
  // setting currentTime mid-clip is a cheap no-op.
  const ensureClipLoaded = useCallback(
    (audioMs: number) => {
      const video = videoRef.current;
      if (!video || !plan) return;
      const clip = findClipAtMs(plan.clips, audioMs);
      if (currentClipRef.current === clip) return;
      currentClipRef.current = clip;
      if (!clip) {
        video.removeAttribute("src");
        video.load();
        return;
      }
      video.src = clip.srcUrl;
      video.playbackRate = clip.speedFactor;
      const offsetSec = ((audioMs - clip.startMs) * clip.speedFactor) / 1000;
      const seekWhenReady = () => {
        try {
          video.currentTime = Math.max(0, offsetSec);
        } catch {
          // ignore seek errors — currentTime can throw if metadata not yet ready
        }
        if (audioRef.current && !audioRef.current.paused) void video.play();
      };
      if (video.readyState >= 1) seekWhenReady();
      else video.addEventListener("loadedmetadata", seekWhenReady, { once: true });
    },
    [plan],
  );

  // Register seek dispatcher for the timeline.
  useEffect(() => {
    playerSeekRef.current = (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = Math.max(0, ms / 1000);
      setPlayheadMs(ms);
      ensureClipLoaded(ms);
    };
    return () => {
      playerSeekRef.current = null;
    };
  }, [ensureClipLoaded, playerSeekRef, setPlayheadMs]);

  // rAF loop: drives playhead, swap detection, and section selection from
  // audio.currentTime while playing.
  useEffect(() => {
    if (!playing || !plan || !timeline) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const audioMs = audio.currentTime * 1000;
      setPlayheadMs(audioMs);
      ensureClipLoaded(audioMs);
      const sectionIdx = findSectionAtMs(timeline, audioMs);
      if (sectionIdx !== null && sectionIdx !== selectedSectionRef.current) {
        selectedSectionRef.current = sectionIdx;
        setSelectedSectionIndex(sectionIdx);
      }
      if (audio.ended) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan, timeline, ensureClipLoaded, setPlayheadMs, setSelectedSectionIndex]);

  // When user clicks a section in the timeline (sets selectedSectionIndex
  // directly, not via the rAF loop), seek the audio to that section's start.
  useEffect(() => {
    if (selectedSectionIndex === null || !timeline || !plan) return;
    const audio = audioRef.current;
    if (!audio) return;
    let cursor = 0;
    for (let i = 0; i < selectedSectionIndex; i++) cursor += timeline[i]!.durationMs;
    // Avoid feedback: only seek when the audio is more than 100ms away from
    // this section's start. Otherwise the rAF loop's own selection update
    // would re-trigger a seek.
    if (Math.abs(audio.currentTime * 1000 - cursor) > 100) {
      audio.currentTime = cursor / 1000;
      setPlayheadMs(cursor);
      ensureClipLoaded(cursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionIndex]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      ensureClipLoaded(audio.currentTime * 1000);
      void audio.play();
      void videoRef.current?.play();
      setPlaying(true);
    }
  }

  if (!audioFile) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Set audio in the toolbar to begin.
      </div>
    );
  }

  const totalMs = timeline?.reduce((s, x) => s + x.durationMs, 0) ?? 0;
  const playheadSection =
    timeline && selectedSectionIndex !== null ? timeline[selectedSectionIndex] : null;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-3">
      <div
        className="bg-black rounded overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: "9 / 16", height: "calc(100% - 48px)", maxWidth: "100%" }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
        />
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
        <span className="font-mono">
          {formatMs((audioRef.current?.currentTime ?? 0) * 1000)} / {formatMs(totalMs)}
        </span>
        {playheadSection && <span>· [{playheadSection.tag}]</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck 2>&1 | grep "preview-player\|playback-plan" | head -10`
Expected: no errors from these files.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "feat(preview-player): continuous end-to-end playback driven by audio clock"
```

---

## Phase 3 — Click-to-seek in timeline

### Task 3.1: Wire timeline clicks to `playerSeekRef`

**Files:**
- Modify: `src/components/editor/timeline/timeline-panel.tsx`

- [ ] **Step 1: Add an onClick handler on the inner content div**

Open `src/components/editor/timeline/timeline-panel.tsx`. Locate the inner `<div>` that wraps `TimelineRuler` / tracks (the one with `style={{ width: ... }} className="relative"`).

Wrap that div's onClick like so. Add to the destructure at the top:

```ts
const {
  timeline,
  audioFile,
  audioDuration,
  selectedSectionIndex,
  setSelectedSectionIndex,
  playheadMs,
  playerSeekRef,
} = useBuildState();
```

Add a click handler before the return:

```ts
function handleScrubClick(e: React.MouseEvent<HTMLDivElement>) {
  // Ignore clicks that bubbled up from a tag/clip block — those have their
  // own onSelect handlers and would double-fire.
  if ((e.target as HTMLElement).closest("button,[data-clip-block]")) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ms = (x / effectivePxPerSec) * 1000;
  playerSeekRef.current?.(Math.max(0, ms));
}
```

Then on the inner content div, add `onClick={handleScrubClick}`:

```tsx
<div
  style={{ width: `${Math.max(totalWidthPx, 1)}px` }}
  className="relative cursor-pointer"
  onClick={handleScrubClick}
>
```

- [ ] **Step 2: Mark clip blocks so the handler ignores them**

Open `src/components/editor/timeline/track-clips.tsx`. On the section wrapper `<div>` (the one that calls `onSelect(i)` and renders the chain row), add `data-clip-block`:

```tsx
<div
  key={i}
  data-clip-block
  onClick={() => onSelect(i)}
  className={cn(...)}
  style={{ ... }}
>
```

The tag track's `<button>` elements already match `closest("button")` so no change needed there.

- [ ] **Step 3: Manual smoke test**

Run: `pnpm dev`

- Set audio + paste script.
- Click anywhere on the ruler / audio waveform → playhead jumps there, video swaps to the right b-roll, inspector follows the section.
- Click a section block in the tag track → still selects that section (no double-jump).
- Press Play → video chains through, you see speed factors visibly differ (1× vs 3× vs 5×) as predicted by the timeline labels. Audio plays continuously.
- Pause/Play resume from current position.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/timeline/timeline-panel.tsx src/components/editor/timeline/track-clips.tsx
git commit -m "feat(timeline): click-to-seek scrubbing wired to player"
```

---

## Acceptance bar

After all tasks, the user can:

1. Open the editor with audio + script set.
2. Press Play once → entire video plays end-to-end without further interaction. Audio is uninterrupted; video swaps b-rolls as sections advance; each clip plays at its own `speedFactor` so over-sped clips are visibly obvious.
3. Pause anywhere; resume from same position.
4. Click anywhere on the timeline ruler/audio waveform → audio + video both jump there.
5. While playing, the Inspector right-hand panel auto-switches to whatever section the playhead is in.
6. All 8 acceptance criteria from the original capcut-editor spec still pass.

## Self-review

- [ ] Spec coverage: rAF clock ✓ (Task 2.2), full plan ✓ (Task 1.2), seek ✓ (Tasks 2.1+2.2+3.1), section follow ✓ (Task 2.2), TDD ✓ (Tasks 1.1, 1.3).
- [ ] Type consistency: `PlaybackPlanClip`, `findClipAtMs`, `findSectionAtMs`, `playerSeekRef` names match across all tasks.
- [ ] No placeholders: every code block is complete.
- [ ] Run before merge: `pnpm typecheck && pnpm test`.
