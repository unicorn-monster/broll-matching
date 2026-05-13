# Shuffle All B-roll — Design

**Date:** 2026-05-13
**Status:** Draft (pre-implementation)

## Problem

Given the same script (timestamps + tags), audio track, and talking-head video, a user wants to regenerate the B-roll assignments with one click — producing a "new" video by re-picking which clip fills each non-talking-head section. Today, the only way to vary B-roll picks is to re-paste the script, which is friction-heavy and also resets manually-locked sections.

## Goals

- One-click action that re-rolls all auto-matched B-roll sections.
- Preserve user-locked sections (`userLocked === true`) exactly.
- Preserve talking-head sections exactly (they are deterministic slices, not B-roll picks).
- Respect adjacency cooldown across locked → auto boundaries so neighbouring auto sections do not repeat clips already locked nearby.
- Pick up new B-roll files added to the media pool after the script was pasted.

## Non-goals

- Re-rolling a single section (out of scope; existing section-editor flow can serve that later).
- Reproducible / seeded variations with prev/next navigation.
- Undo history.
- Validation or recovery of locked sections that reference deleted clips.
- Animation / per-clip "just changed" highlighting.
- Persisting shuffle output to disk.

## Architecture

### Pure helper — `src/lib/shuffle.ts`

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
  shuffledCount: number;       // auto sections that ran through matchSections
  lockedKeptCount: number;     // sections preserved because userLocked
  talkingHeadCount: number;    // sections preserved because TH slice
  placeholderCount: number;    // auto sections that ended up as placeholder
}

export function shuffleTimeline(
  oldTimeline: MatchedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  talkingHead?: TalkingHeadConfig | null,
  rng: () => number = Math.random,
): ShuffleResult;
```

**Algorithm:**

```
state = createMatchState(rng)
counts = { shuffled: 0, lockedKept: 0, talkingHead: 0, placeholder: 0 }
newTimeline = []

for each section in oldTimeline (in order):
  if section is talking-head (any clip has sourceSeekMs defined):
    push section unchanged
    counts.talkingHead++
    continue

  if section.userLocked:
    push section unchanged
    for each real clip in section.clips: markUsed(state, tag, clipId)
    counts.lockedKept++
    continue

  // Auto section — rebuild ParsedSection shape from MatchedSection.
  // lineNumber/scriptText are required by the interface but unused by matchSections;
  // pass safe stubs.
  ps: ParsedSection = {
    lineNumber: 0,
    scriptText: "",
    startTime: section.startMs / 1000,
    endTime: section.endMs / 1000,
    durationMs: section.durationMs,
    tag: section.tag,
  }
  matched = matchSections([ps], clipsByBaseName, state, talkingHead)[0]
  matched.sectionIndex = section.sectionIndex  // preserve index from old timeline
  push matched
  if matched.clips.every(c => c.isPlaceholder):
    counts.placeholder++
  else:
    counts.shuffled++

return { newTimeline, ...counts }
```

Notes on the algorithm:

1. **TH detection.** Talking-head clips are the only ones with `sourceSeekMs !== undefined`. This matches the discriminator already used in `editor-shell.tsx:113`. No need to thread the `talkingHead` config into the detection.
2. **Order matters.** `markUsed` for locked clips must execute *before* the next auto-section is matched so cooldown carries through correctly. Iterating in order achieves this.
3. **`sectionIndex` carry-over.** `matchSections` always sets `sectionIndex = 0` when called with a single-element array; we overwrite with the original index so downstream consumers (timeline, preview) see the same indexes after shuffle.
4. **Placeholder counting.** A section is "placeholder" iff every clip in `matched.clips` has `isPlaceholder: true`. Today that means a single placeholder (matcher path produces one), but the check is robust if `matchSections` evolves.
5. **TH config passthrough.** We pass `talkingHead` into `matchSections` even though the loop already filters TH sections out. This is defence-in-depth: if a section's tag matches the TH tag but for some reason was not detected as TH, the matcher still does the right thing.

### State integration — `src/components/build/build-state-context.tsx`

Add to context surface:

```ts
shuffleTimeline: () => void;
```

The pure helper in `src/lib/shuffle.ts` is exported as `shuffleTimeline`. In the BuildState file, import it as `shuffleTimelineHelper` to avoid the name collision with the context method:

```ts
import { shuffleTimeline as shuffleTimelineHelper } from "@/lib/shuffle";
```

Implementation:

```ts
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

`buildShuffleToast(result)` returns a string like:
- `"Shuffled 12 sections"` — when no locks / no TH.
- `"Shuffled 12 sections · 3 locked kept · 8 talking-head"` — full breakdown when any of the trailing counts is > 0.
- `"Shuffled 0 sections · 5 locked kept"` — when nothing was actually re-rolled, so user understands why nothing changed.
- Placeholder count is appended as `· 2 unmatched` only when > 0.

Race condition with rapid double-clicks is accepted: each click reads `timeline` via closure and produces a valid result; the second click's `MatchState` is fresh, so cooldown between clicks does not carry, but the user-visible output is still a valid shuffle.

### UI — `src/components/editor/toolbar/shuffle-button.tsx`

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
    >
      <Shuffle className="w-3.5 h-3.5 mr-1.5" />
      Shuffle
    </Button>
  );
}
```

Mounted immediately before `<ExportButton />` in `editor-shell.tsx`.

## Data flow

1. User clicks Shuffle button.
2. `shuffleTimeline()` in BuildState reads current `timeline`, `mediaPoolClips`, `talkingHeadFile`, `talkingHeadTag`.
3. Builds `clipsByBaseName` from current media pool snapshot.
4. Calls pure `shuffleTimeline(oldTimeline, clipsByBaseName, thConfig)` helper.
5. `setTimeline(result.newTimeline)` triggers React re-render: timeline panel re-paints, inspector re-renders (selectedSection derives via `timeline[selectedSectionIndex]`).
6. `setPreviewClipKey(null)` closes any open clip preview because the previously-previewed clip may not be in the new timeline.
7. `toast.success(...)` shows counts.

## Edge cases

| Case | Behaviour |
|---|---|
| `timeline === null` | Button disabled, action no-ops. |
| All sections locked | Button enabled. Shuffle runs, returns same timeline reference-wise different but value-equivalent. Toast says "0 shuffled · N locked kept". |
| All sections are talking-head | Button enabled. 0 shuffled, all in `talkingHeadCount`. |
| Section tag has 1 clip in pool | Matcher picks the same clip. Counted as `shuffled` (matcher ran). |
| Section tag has 0 clips in pool | Returns placeholder. Counted in `placeholderCount`. |
| User added new clips to media pool after paste | Picked up automatically — `clipsByBaseName` rebuilt at shuffle time. |
| Locked section references deleted clip (orphan) | Preserved as-is. Out of shuffle's scope; existing render/export validation will surface the issue. |
| User double-clicks rapidly | Both rolls produce valid timelines; cooldown does not carry between rolls. Acceptable. |
| `selectedSectionIndex` was set | Selection survives; the section now points at the new (or preserved-locked) clip in that slot. |

## Risks ruled out by codebase inspection

- **Stale inspector data.** `editor-shell.tsx:109` derives `selectedSection` from `timeline[selectedSectionIndex]` on every render — no caching.
- **Stale section-editor state.** `src/components/build/section-editor/*` components are not currently mounted anywhere in the live UI (verified by grep — no importer outside the directory). They cannot hold stale local state because they cannot render.
- **Talking-head re-match effect re-fires.** The effect in `build-state-context.tsx:144` depends on `talkingHeadFile` and `talkingHeadTag`. Shuffle does not touch those, so the effect does not fire.
- **Overlay invalidation.** Overlays reference `clipId` directly, independent of section assignments. Shuffle changes section assignments, not which clipIds exist. Overlays remain valid.

## Testing

Add `src/lib/__tests__/shuffle.test.ts` covering:

1. **Talking-head preservation.** Build a timeline where some sections have TH clips (`sourceSeekMs !== undefined`). Call `shuffleTimeline`. Assert TH clips come through unchanged byte-for-byte. Assert `talkingHeadCount` correct.
2. **Locked preservation.** Build a timeline with mixed `userLocked` and auto sections. Assert locked sections come through with identical `clips`, `speedFactor`, `userLocked: true`. Assert `lockedKeptCount` correct.
3. **Auto sections re-rolled.** With a pool of ≥ 2 clips per tag and a seeded RNG, assert the picks for auto sections differ from a baseline `matchSections` call seeded differently. Also assert the same `rng` produces identical output (determinism).
4. **Cooldown carry across lock boundary.** Section[0] is locked with clip `A`. Section[1] is auto with same tag; pool = `[A, B]`. After shuffle, section[1] must pick `B` (cooldown for `A` was bumped by `markUsed`).
5. **Empty pool.** Section tag has no clips in `clipsByBaseName`. Assert section comes back as placeholder; `placeholderCount === 1`; `shuffledCount === 0` for that section.
6. **Single-clip pool.** Tag has exactly 1 clip; 1 auto section uses that tag. Assert matcher still picks it; counted as `shuffled`.
7. **`sectionIndex` preserved.** Old timeline has non-contiguous `sectionIndex` (e.g., 0, 1, 2). After shuffle, indexes match the originals.
8. **`mediaPool` snapshot effect.** Pass a `clipsByBaseName` that contains a clip not present in the old timeline's universe. Assert the new clip is eligible for picks (this is implicit because `clipsByBaseName` is the source of truth for the matcher).

`buildShuffleToast` is not unit-tested — it is a pure string formatter coupled to UI copy; testing it just couples tests to wording.

## Implementation order

1. Helper + tests (`src/lib/shuffle.ts`, `src/lib/__tests__/shuffle.test.ts`).
2. State integration (`shuffleTimeline` in `build-state-context.tsx`, toast formatter inline).
3. UI (`shuffle-button.tsx` + mount in `editor-shell.tsx`).
4. Manual smoke test in dev server with the demo project visible in the screenshot (73 sections, 1 TH tag, some locked).
