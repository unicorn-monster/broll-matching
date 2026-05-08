# Absolute B-roll Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place each B-roll at the absolute timestamp from its script line (HH:MM:SS,mmm), instead of at a position derived by cumulating prior section durations. Gaps render as black + audio; the rendered MP4 is always exactly `audioDuration` long.

**Architecture:** Carry `startMs` / `endMs` as first-class fields on `MatchedSection` (the data type that flows from parser → matcher → editor → playback → render). All consumers read those fields directly instead of running a cumulative `cursor`. Parser gains overlap detection and an `audioDurationMs` bound check. Render pipeline injects black MPEG-TS segments into the gaps before/between/after scripted regions so the final video matches audio length exactly.

**Tech Stack:** TypeScript, React (Next.js App Router), Vitest, ffmpeg (native via `/api/render`).

**Spec:** [docs/superpowers/specs/2026-05-04-absolute-broll-positioning-design.md](../specs/2026-05-04-absolute-broll-positioning-design.md)

---

## File Map

**Modified (production):**
- `src/lib/auto-match.ts` — add `startMs` / `endMs` to `MatchedSection`; copy from `ParsedSection` in `matchSections`
- `src/lib/script-parser.ts` — accept `audioDurationMs` (optional); add overlap + bound errors
- `src/lib/playback-plan.ts` — use `section.startMs` instead of cumulating `durationMs`; `findSectionAtMs` returns `null` in gaps
- `src/lib/lock-preserve.ts` — copy `startMs` / `endMs` from new `ParsedSection`, not old locked section
- `src/components/editor/timeline/track-tags.tsx` — position blocks by `section.startMs`
- `src/components/editor/timeline/track-clips.tsx` — position blocks by `section.startMs`
- `src/components/editor/timeline/timeline-panel.tsx` — `totalMs` from `audioDuration`, not cumulative section sum
- `src/components/build/script-paste.tsx` — accept `audioDuration` and pass `audioDurationMs` into `parseScript`
- `src/components/build/render-trigger.tsx` — append `audioDurationMs` to render FormData
- `src/app/api/render/route.ts` — read `audioDurationMs`; build segments with leading/middle/trailing black gaps; remove empty-segments error

**Modified (tests):**
- `src/lib/__tests__/auto-match.test.ts` — assert `startMs` / `endMs` are propagated
- `src/lib/__tests__/script-parser.test.ts` — overlap error, bound error, neighbor-touching OK
- `src/lib/__tests__/playback-plan.test.ts` — rewrite for absolute positions, add gap tests
- `src/lib/__tests__/lock-preserve.test.ts` — assert preserved entries take `startMs` / `endMs` from new `ns`

---

## Pre-flight

- [ ] **Step 0: Confirm baseline tests pass**

Run: `pnpm test --run`
Expected: All tests pass on `feat/srt-style-script-format` branch as a clean starting point.

---

## Task 1: Add `startMs` / `endMs` to `MatchedSection`

**Files:**
- Modify: `src/lib/auto-match.ts:75-82` (`MatchedSection` interface), `src/lib/auto-match.ts:199-255` (`matchSections`)
- Test: `src/lib/__tests__/auto-match.test.ts`

- [ ] **Step 1.1: Write the failing test**

Add this `describe` block at the end of `src/lib/__tests__/auto-match.test.ts`:

```ts
describe("matchSections — absolute positioning", () => {
  it("propagates startMs and endMs from the input ParsedSection", () => {
    const clips = [makeClip("hook-01", 5000)];
    const map = buildClipsByBaseName(clips);
    const ps: ParsedSection = {
      lineNumber: 1,
      startTime: 12.5,           // 12500ms
      endTime: 16.0,             // 16000ms
      tag: "Hook",
      scriptText: "x",
      durationMs: 3500,
    };
    const matched = matchSections([ps], map)[0]!;
    expect(matched.startMs).toBe(12500);
    expect(matched.endMs).toBe(16000);
    expect(matched.durationMs).toBe(3500);
  });

  it("propagates startMs/endMs even for placeholder (no matching tag) sections", () => {
    const ps: ParsedSection = {
      lineNumber: 1,
      startTime: 5,
      endTime: 8,
      tag: "unknown",
      scriptText: "x",
      durationMs: 3000,
    };
    const matched = matchSections([ps], new Map())[0]!;
    expect(matched.clips[0]!.isPlaceholder).toBe(true);
    expect(matched.startMs).toBe(5000);
    expect(matched.endMs).toBe(8000);
  });

  it("propagates startMs/endMs for zero-duration sections", () => {
    const ps: ParsedSection = {
      lineNumber: 1,
      startTime: 7,
      endTime: 7,
      tag: "Hook",
      scriptText: "x",
      durationMs: 0,
    };
    const matched = matchSections([ps], new Map())[0]!;
    expect(matched.startMs).toBe(7000);
    expect(matched.endMs).toBe(7000);
    expect(matched.durationMs).toBe(0);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm test --run src/lib/__tests__/auto-match.test.ts`
Expected: Three new tests FAIL because `matched.startMs` and `matched.endMs` are `undefined`.

- [ ] **Step 1.3: Add `startMs` and `endMs` fields to the interface**

Edit `src/lib/auto-match.ts` lines 75-82:

```ts
export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
  userLocked?: boolean;
}
```

- [ ] **Step 1.4: Populate the new fields in `matchSections`**

In `src/lib/auto-match.ts` inside `matchSections`, every `return { sectionIndex, tag: section.tag, durationMs: ..., ... }` literal must add `startMs` and `endMs` derived from the input section. Replace the whole `return sections.map((section, sectionIndex) => { ... })` body so each return path includes the absolute timestamps:

```ts
export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  state?: MatchState,
): MatchedSection[] {
  const s = state ?? createMatchState();
  return sections.map((section, sectionIndex) => {
    const startMs = section.startTime * 1000;
    const endMs = section.endTime * 1000;
    const warnings: string[] = [];

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, startMs, endMs, durationMs: 0, clips: [], warnings };
    }

    const key = section.tag.toLowerCase();
    const candidates = clipsByBaseName.get(key) ?? [];

    if (candidates.length === 0) {
      warnings.push(`No B-roll found for tag: ${section.tag}`);
      return {
        sectionIndex,
        tag: section.tag,
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", fileId: "", speedFactor: 1.0, isPlaceholder: true }],
        warnings,
      };
    }

    const eligible = candidates.filter((c) => c.durationMs >= section.durationMs);
    if (eligible.length === 0) {
      warnings.push(`No B-roll long enough for tag: ${section.tag} (need ≥${section.durationMs}ms)`);
      return {
        sectionIndex,
        tag: section.tag,
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", fileId: "", speedFactor: 1, isPlaceholder: true }],
        warnings,
      };
    }

    const clip = pickFromState(s, key, eligible);
    return {
      sectionIndex,
      tag: section.tag,
      startMs,
      endMs,
      durationMs: section.durationMs,
      clips: [{
        clipId: clip.id,
        fileId: clip.fileId,
        speedFactor: 1,
        trimDurationMs: section.durationMs,
        isPlaceholder: false,
      }],
      warnings,
    };
  });
}
```

- [ ] **Step 1.5: Run the new tests — verify pass**

Run: `pnpm test --run src/lib/__tests__/auto-match.test.ts`
Expected: All `auto-match` tests pass (existing + the three new ones).

- [ ] **Step 1.6: Run full test suite — confirm no other test broke**

Run: `pnpm test --run`
Expected: All pass. Existing `playback-plan.test.ts` and `lock-preserve.test.ts` use `as MatchedSection[]` casts that bypass the type check, so they keep compiling. `tsc` will not error because the type widening only affects new construction sites.

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): add startMs/endMs to MatchedSection

Carries the absolute audio-timeline position from ParsedSection
through to MatchedSection so consumers can render brolls at their
script-specified timestamps instead of a cumulative cursor."
```

---

## Task 2: Parser overlap + bound validation

**Files:**
- Modify: `src/lib/script-parser.ts:44` (signature), `src/lib/script-parser.ts:99-107` (after sections accumulated, run new checks)
- Test: `src/lib/__tests__/script-parser.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Append to `src/lib/__tests__/script-parser.test.ts`:

```ts
describe("parseScript — overlap detection", () => {
  it("errors when two lines overlap, pointing at the later line", () => {
    const input = [
      "00:00:01,000 --> 00:00:05,000 || Hook || first",
      "00:00:03,000 --> 00:00:07,000 || Hook || overlaps first",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toMatch(/overlap/i);
  });

  it("accepts adjacent lines that touch (curr.startMs === prev.endMs) — no overlap", () => {
    const input = [
      "00:00:01,000 --> 00:00:05,000 || Hook || first",
      "00:00:05,000 --> 00:00:07,000 || Hook || touches",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lines with a gap between them", () => {
    const input = [
      "00:00:01,000 --> 00:00:05,000 || Hook || first",
      "00:00:10,000 --> 00:00:12,000 || Hook || far later",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors).toHaveLength(0);
  });

  it("detects overlap regardless of line order in the script", () => {
    // Second-listed line starts earlier and overlaps the first line.
    const input = [
      "00:00:05,000 --> 00:00:09,000 || Hook || late line",
      "00:00:00,000 --> 00:00:06,000 || Hook || early line, overlaps",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => /overlap/i.test(e.message))).toBe(true);
  });
});

describe("parseScript — audio bound check", () => {
  it("errors when endTime exceeds audioDurationMs", () => {
    const result = parseScript(
      "00:00:08,000 --> 00:00:12,000 || Hook || past end",
      BASE_NAMES,
      10_000, // audio is 10s, line ends at 12s
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toMatch(/audio/i);
  });

  it("accepts endTime equal to audioDurationMs (boundary inclusive)", () => {
    const result = parseScript(
      "00:00:08,000 --> 00:00:10,000 || Hook || ends right at end",
      BASE_NAMES,
      10_000,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("skips bound check when audioDurationMs is null (audio not loaded yet)", () => {
    const result = parseScript(
      "00:00:08,000 --> 00:00:120,000 || Hook || would normally fail",
      BASE_NAMES,
      null,
    );
    expect(result.errors.filter((e) => /audio/i.test(e.message))).toHaveLength(0);
  });
});
```

- [ ] **Step 2.2: Run tests — verify they fail**

Run: `pnpm test --run src/lib/__tests__/script-parser.test.ts`
Expected: New tests FAIL: overlap tests fail because no overlap detection runs; bound tests fail because the third arg is unknown to the parser.

- [ ] **Step 2.3: Update parser signature and validation rules**

Edit `src/lib/script-parser.ts`. Replace the function signature and append the new validation block before `return { sections, errors, warnings };`:

```ts
export function parseScript(
  text: string,
  availableBaseNames: Set<string>,
  audioDurationMs: number | null = null,
): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: { line: number; message: string }[] = [];

  const lines = text.split("\n");
  lines.forEach((raw, idx) => {
    // ... existing per-line parsing unchanged ...
  });

  // Overlap detection: sort by start, check each adjacent pair.
  // Errors are pushed against the *later* line (the one that pushed past prev.endMs).
  const sorted = [...sections].sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr.startTime < prev.endTime) {
      errors.push({
        line: curr.lineNumber,
        message: `Line ${curr.lineNumber}: time range [${formatTimestamp(curr.startTime)}, ${formatTimestamp(curr.endTime)}] overlaps line ${prev.lineNumber} [${formatTimestamp(prev.startTime)}, ${formatTimestamp(prev.endTime)}]`,
      });
    }
  }

  // Audio bound check: every line must end within the audio.
  if (audioDurationMs !== null) {
    for (const s of sections) {
      const endMs = s.endTime * 1000;
      if (endMs > audioDurationMs) {
        errors.push({
          line: s.lineNumber,
          message: `Line ${s.lineNumber}: end time ${formatTimestamp(s.endTime)} exceeds audio duration ${formatTimestamp(audioDurationMs / 1000)}`,
        });
      }
    }
  }

  return { sections, errors, warnings };
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
}
```

Keep the entire body of the existing per-line parsing loop unchanged — only the function signature, the post-loop validation block, and the new helper `formatTimestamp` are added. `availableBaseNames` (parameter 2) and the unknown-tag warning logic are unchanged.

- [ ] **Step 2.4: Run parser tests — verify they pass**

Run: `pnpm test --run src/lib/__tests__/script-parser.test.ts`
Expected: All parser tests pass (existing 17 + 7 new). Existing tests don't break because the new third parameter defaults to `null`.

- [ ] **Step 2.5: Run the full suite**

Run: `pnpm test --run`
Expected: All pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/script-parser.ts src/lib/__tests__/script-parser.test.ts
git commit -m "feat(script-parser): detect line overlap and audio-bound violations

Two new error rules:
- Overlapping time ranges → error on the later line.
- endTime > audioDurationMs → error on that line; check is
  skipped when audioDurationMs is null (audio not loaded yet)."
```

---

## Task 3: Playback plan absolute positioning

**Files:**
- Modify: `src/lib/playback-plan.ts:38-103` (`buildSectionPlaybackPlan`, `buildFullTimelinePlaybackPlan`), `src/lib/playback-plan.ts:122-130` (`findSectionAtMs`)
- Test: `src/lib/__tests__/playback-plan.test.ts`

- [ ] **Step 3.1: Update existing tests + add gap tests (replace whole file)**

Overwrite `src/lib/__tests__/playback-plan.test.ts` with this content:

```ts
import { describe, it, expect } from "vitest";
import { buildSectionPlaybackPlan, buildFullTimelinePlaybackPlan, findClipAtMs, findSectionAtMs, clipIdentityKey } from "../playback-plan";
import type { MatchedSection } from "../auto-match";

const seg = (
  _durationMs: number,
  speedFactor: number,
  isPlaceholder = false,
  i = 0,
) => ({
  clipId: `c${i}`,
  fileId: `k${i}`,
  speedFactor,
  isPlaceholder,
});

function ms(start: number, end: number, clips: { key: string; speed: number; placeholder?: boolean }[]): MatchedSection {
  return {
    sectionIndex: 0,
    tag: "x",
    startMs: start,
    endMs: end,
    durationMs: end - start,
    userLocked: false,
    warnings: [],
    clips: clips.map((c) => ({
      clipId: `id-${c.key}`,
      fileId: c.key,
      speedFactor: c.speed,
      isPlaceholder: !!c.placeholder,
    })),
  };
}

describe("buildSectionPlaybackPlan", () => {
  it("uses section.startMs as audioStartMs (absolute, not cumulative)", () => {
    const timeline: MatchedSection[] = [
      { sectionIndex: 0, tag: "a", startMs: 0,    endMs: 5000,  durationMs: 5000, clips: [seg(5000, 1)], warnings: [] },
      { sectionIndex: 1, tag: "b", startMs: 8000, endMs: 11000, durationMs: 3000, clips: [seg(3000, 1, false, 1)], warnings: [] },
      { sectionIndex: 2, tag: "c", startMs: 20000, endMs: 24000, durationMs: 4000, clips: [seg(4000, 1, false, 2)], warnings: [] },
    ];
    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"], ["k2", "blob:2"]]);

    const plan = buildSectionPlaybackPlan(timeline, 1, "blob:audio", blobs);

    expect(plan.audioStartMs).toBe(8000);
    expect(plan.audioUrl).toBe("blob:audio");
  });

  it("emits one entry per non-placeholder clip with correct speedFactor", () => {
    const timeline: MatchedSection[] = [
      ms(0, 5000, [{ key: "k0", speed: 1.5 }, { key: "k1", speed: 1.5 }]),
    ];
    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"]]);

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);

    expect(plan.clips).toHaveLength(2);
    expect(plan.clips[0]).toMatchObject({ srcUrl: "blob:0", speedFactor: 1.5 });
    expect(plan.clips[1]).toMatchObject({ srcUrl: "blob:1", speedFactor: 1.5 });
  });

  it("produces empty clips array when section is placeholder-only (renders black)", () => {
    const timeline: MatchedSection[] = [ms(0, 4000, [{ key: "k0", speed: 1, placeholder: true }])];
    const blobs = new Map();
    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toEqual([]);
  });

  it("skips clips whose blob URL is missing (defensive)", () => {
    const timeline: MatchedSection[] = [
      ms(0, 2000, [{ key: "k0", speed: 1 }, { key: "k1", speed: 1 }]),
    ];
    const blobs = new Map([["k0", "blob:0"]]); // k1 missing

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.srcUrl).toBe("blob:0");
    expect(plan.clips[0]!.startMs).toBe(0);
    expect(plan.clips[0]!.endMs).toBe(1000);
  });
});

describe("buildFullTimelinePlaybackPlan", () => {
  it("returns empty clips when timeline is empty", () => {
    const plan = buildFullTimelinePlaybackPlan([], "audio.mp3", new Map());
    expect(plan.clips).toEqual([]);
    expect(plan.audioUrl).toBe("audio.mp3");
  });

  it("emits clips with absolute startMs based on section.startMs (gaps preserved)", () => {
    const timeline: MatchedSection[] = [
      ms(1000, 3000, [{ key: "a", speed: 1 }]),         // 1s..3s
      ms(10000, 13000, [                                  // 10s..13s, two clips → 1.5s each
        { key: "b", speed: 2 },
        { key: "c", speed: 1.5 },
      ]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"], ["c", "blob:c"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 1000,  endMs: 3000,  speedFactor: 1,   fileId: "a" },
      { srcUrl: "blob:b", startMs: 10000, endMs: 11500, speedFactor: 2,   fileId: "b" },
      { srcUrl: "blob:c", startMs: 11500, endMs: 13000, speedFactor: 1.5, fileId: "c" },
    ]);
  });

  it("skips placeholder-only sections — gap stays as gap (no clips emitted)", () => {
    const timeline: MatchedSection[] = [
      ms(0,    1000, [{ key: "a", speed: 1 }]),
      ms(1000, 3000, [{ key: "_", speed: 1, placeholder: true }]),
      ms(3000, 4000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0,    endMs: 1000, speedFactor: 1, fileId: "a" },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1, fileId: "b" },
    ]);
  });

  it("skips a real clip whose blob URL is missing", () => {
    const timeline: MatchedSection[] = [
      ms(0,    1000, [{ key: "a", speed: 1 }]),
      ms(1000, 3000, [{ key: "missing", speed: 1 }]),
      ms(3000, 4000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0,    endMs: 1000, speedFactor: 1, fileId: "a" },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1, fileId: "b" },
    ]);
  });
});

describe("findClipAtMs", () => {
  const clips = [
    { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1, fileId: "a" },
    { srcUrl: "blob:b", startMs: 1000, endMs: 2500, speedFactor: 1.5, fileId: "b" },
    { srcUrl: "blob:c", startMs: 2500, endMs: 4000, speedFactor: 1, fileId: "c" },
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
  const timeline: MatchedSection[] = [
    ms(0,    1000, []),
    ms(3000, 5000, []),    // gap from 1000..3000
    ms(5000, 5500, []),
  ];

  it("maps an audio time to the section whose [startMs, endMs) contains it", () => {
    expect(findSectionAtMs(timeline, 0)).toBe(0);
    expect(findSectionAtMs(timeline, 999)).toBe(0);
    expect(findSectionAtMs(timeline, 3000)).toBe(1);
    expect(findSectionAtMs(timeline, 4999)).toBe(1);
    expect(findSectionAtMs(timeline, 5000)).toBe(2);
    expect(findSectionAtMs(timeline, 5499)).toBe(2);
  });

  it("returns null when ms falls in a gap between sections", () => {
    expect(findSectionAtMs(timeline, 1000)).toBeNull();
    expect(findSectionAtMs(timeline, 2999)).toBeNull();
  });

  it("returns null past the last section's end", () => {
    expect(findSectionAtMs(timeline, 5500)).toBeNull();
    expect(findSectionAtMs(timeline, 9999)).toBeNull();
  });

  it("returns null on empty timeline", () => {
    expect(findSectionAtMs([], 0)).toBeNull();
  });
});

describe("clipIdentityKey", () => {
  it("returns fileId:startMs", () => {
    const clip = { srcUrl: "blob:abc", startMs: 1500, endMs: 3000, speedFactor: 1, fileId: "k7" };
    expect(clipIdentityKey(clip)).toBe("k7:1500");
  });

  it("differentiates same blob at different startMs (same clip used twice)", () => {
    const a = { srcUrl: "blob:abc", startMs: 0, endMs: 1000, speedFactor: 1, fileId: "k1" };
    const b = { srcUrl: "blob:abc", startMs: 4000, endMs: 5000, speedFactor: 1, fileId: "k1" };
    expect(clipIdentityKey(a)).not.toBe(clipIdentityKey(b));
  });

  it("matches across plan rebuilds when key+startMs are equal", () => {
    const a = { srcUrl: "blob:1", startMs: 2000, endMs: 4000, speedFactor: 1, fileId: "k3" };
    const a2 = { srcUrl: "blob:2", startMs: 2000, endMs: 4000, speedFactor: 1.2, fileId: "k3" };
    expect(clipIdentityKey(a)).toBe(clipIdentityKey(a2));
  });
});
```

- [ ] **Step 3.2: Run — many tests fail**

Run: `pnpm test --run src/lib/__tests__/playback-plan.test.ts`
Expected: Tests fail because production code still uses cumulative cursor. The `findSectionAtMs` gap test fails because the current implementation returns the wrong index in gaps.

- [ ] **Step 3.3: Rewrite `buildSectionPlaybackPlan`**

In `src/lib/playback-plan.ts`, replace the function with:

```ts
export function buildSectionPlaybackPlan(
  timeline: MatchedSection[],
  sectionIndex: number,
  audioUrl: string,
  clipBlobUrls: Map<string, string>,
): PlaybackPlan {
  const section = timeline[sectionIndex];
  if (!section) return { clips: [], audioUrl, audioStartMs: 0 };

  const audioStartMs = section.startMs;

  const real = section.clips.filter((c) => !c.isPlaceholder);
  if (real.length === 0) return { clips: [], audioUrl, audioStartMs };

  const clips: PlaybackPlanClip[] = [];
  let cursor = 0;
  const slot = section.durationMs / real.length;
  for (const c of real) {
    const url = clipBlobUrls.get(c.fileId);
    const startMs = cursor;
    const endMs = cursor + slot;
    cursor = endMs;
    if (!url) continue;
    clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor, fileId: c.fileId });
  }

  return { clips, audioUrl, audioStartMs };
}
```

Note: clip `startMs`/`endMs` here are still relative to the section (the player consumes them as offsets within the section). The player + master audio handle absolute placement via `audioStartMs`.

- [ ] **Step 3.4: Rewrite `buildFullTimelinePlaybackPlan`**

```ts
export function buildFullTimelinePlaybackPlan(
  timeline: MatchedSection[],
  audioUrl: string,
  clipBlobUrls: Map<string, string>,
): PlaybackPlan {
  const clips: PlaybackPlanClip[] = [];
  for (const section of timeline) {
    const real = section.clips.filter((c) => !c.isPlaceholder);
    if (real.length === 0) continue;
    const slot = section.durationMs / real.length;
    for (let i = 0; i < real.length; i++) {
      const c = real[i]!;
      const startMs = section.startMs + slot * i;
      const endMs = startMs + slot;
      const url = clipBlobUrls.get(c.fileId);
      if (!url) continue;
      clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor, fileId: c.fileId });
    }
  }
  return { clips, audioUrl, audioStartMs: 0 };
}
```

- [ ] **Step 3.5: Rewrite `findSectionAtMs`**

```ts
export function findSectionAtMs(timeline: MatchedSection[], ms: number): number | null {
  for (let i = 0; i < timeline.length; i++) {
    const s = timeline[i]!;
    if (ms >= s.startMs && ms < s.endMs) return i;
  }
  return null;
}
```

- [ ] **Step 3.6: Update the doc comment block above `buildSectionPlaybackPlan`**

Replace the existing JSDoc block (lines 21-37 in the original) with:

```ts
/**
 * Builds a per-section playback plan for the preview player. The plan tells the
 * player which clip blob URLs to render and where in the master audio track to
 * start playback so video and voice-over stay in lockstep.
 *
 * - `audioStartMs` is the section's absolute start position on the master audio
 *   timeline, taken directly from `section.startMs`.
 * - `clips` is one entry per non-placeholder MatchedClip with a resolved blob URL.
 *   Placeholder-only sections produce an empty array (player renders black).
 *   Clips whose blob hasn't been loaded yet are skipped defensively rather than
 *   blocking playback. The skipped clip's slot still advances the local cursor so
 *   surviving clips stay aligned with the master audio.
 *
 * `startMs`/`endMs` on each emitted clip are relative to the section start (offsets
 * within the section), matching how `matchSections` distributes a chain's playback
 * time. The player adds `audioStartMs` when seeking the master audio.
 */
```

- [ ] **Step 3.7: Run playback-plan tests — verify pass**

Run: `pnpm test --run src/lib/__tests__/playback-plan.test.ts`
Expected: All pass.

- [ ] **Step 3.8: Run full suite**

Run: `pnpm test --run`
Expected: All pass.

- [ ] **Step 3.9: Commit**

```bash
git add src/lib/playback-plan.ts src/lib/__tests__/playback-plan.test.ts
git commit -m "feat(playback-plan): use absolute section.startMs

audioStartMs comes directly from section.startMs (no cumulative reduce).
buildFullTimelinePlaybackPlan emits clips at section.startMs + slot offset.
findSectionAtMs returns null when ms falls in a gap between sections."
```

---

## Task 4: Lock-preserve carries timestamps from new ParsedSection

**Files:**
- Modify: `src/lib/lock-preserve.ts:58-68` (preserved branch) and `src/lib/lock-preserve.ts:72-73` (auto-match branch)
- Test: `src/lib/__tests__/lock-preserve.test.ts`

- [ ] **Step 4.1: Write the failing test**

Append to `src/lib/__tests__/lock-preserve.test.ts`:

```ts
describe("preserveLocks — absolute positioning", () => {
  it("preserved entry takes startMs/endMs from the new ParsedSection (not the old lock)", () => {
    const c1 = makeClip("c1", "hook-01", 5000);
    const old: MatchedSection[] = [
      { ...makeMatched("hook", 5000, ["c1"], true), startMs: 1000, endMs: 6000 },
    ];
    // New script: same tag/duration but moved to a different absolute position.
    const newSections: ParsedSection[] = [
      { lineNumber: 1, startTime: 30, endTime: 35, tag: "hook", scriptText: "", durationMs: 5000 },
    ];
    const map = new Map([["hook", [c1]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.newTimeline[0]!.startMs).toBe(30000);
    expect(result.newTimeline[0]!.endMs).toBe(35000);
  });

  it("auto-matched (non-preserved) entries also carry startMs/endMs from the new ParsedSection", () => {
    const newSections: ParsedSection[] = [
      { lineNumber: 1, startTime: 5, endTime: 8, tag: "hook", scriptText: "", durationMs: 3000 },
    ];
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks([], newSections, map);

    expect(result.newTimeline[0]!.startMs).toBe(5000);
    expect(result.newTimeline[0]!.endMs).toBe(8000);
  });
});
```

Also fix the `makeMatched` helper at the top of the file so the existing tests still build a complete `MatchedSection`. Replace the helper with:

```ts
const makeMatched = (
  tag: string,
  durationMs: number,
  clipIds: string[],
  userLocked = false,
  startMs = 0,
): MatchedSection => ({
  sectionIndex: 0,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: clipIds.map((id) => ({
    clipId: id,
    fileId: id,
    speedFactor: 1,
    isPlaceholder: false,
  })),
  warnings: [],
  userLocked,
});
```

- [ ] **Step 4.2: Run lock-preserve tests — verify the new ones fail**

Run: `pnpm test --run src/lib/__tests__/lock-preserve.test.ts`
Expected: The two new tests fail (returned `startMs` is `undefined`). Existing tests pass thanks to the updated helper.

- [ ] **Step 4.3: Update `preserveLocks` to populate startMs/endMs from `ns`**

In `src/lib/lock-preserve.ts`, the preserved-branch object literal currently is:

```ts
newTimeline.push({
  sectionIndex: i,
  tag: ns.tag,
  durationMs: ns.durationMs,
  clips: head.clips.map((c) => ({ ... })),
  warnings: [],
  userLocked: true,
});
```

Add `startMs` and `endMs`:

```ts
newTimeline.push({
  sectionIndex: i,
  tag: ns.tag,
  startMs: ns.startTime * 1000,
  endMs: ns.endTime * 1000,
  durationMs: ns.durationMs,
  clips: head.clips.map((c) => ({
    ...c,
    speedFactor: c.isPlaceholder ? 1 : newSpeed,
  })),
  warnings: [],
  userLocked: true,
});
```

The auto-match branch (`else { const matched = matchSections(...)[0]!; newTimeline.push({ ...matched, sectionIndex: i }); }`) already inherits `startMs`/`endMs` from `matchSections` (Task 1) — no change needed there.

- [ ] **Step 4.4: Run lock-preserve tests — verify pass**

Run: `pnpm test --run src/lib/__tests__/lock-preserve.test.ts`
Expected: All pass.

- [ ] **Step 4.5: Run full suite**

Run: `pnpm test --run`
Expected: All pass.

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/lock-preserve.ts src/lib/__tests__/lock-preserve.test.ts
git commit -m "feat(lock-preserve): carry startMs/endMs from new ParsedSection

A re-pasted line that moved in time still binds the same locked picks
at its new absolute position."
```

---

## Task 5: Editor timeline absolute positioning

**Files:**
- Modify: `src/components/editor/timeline/track-tags.tsx:14-46`
- Modify: `src/components/editor/timeline/track-clips.tsx:14-50`
- Modify: `src/components/editor/timeline/timeline-panel.tsx:41-46`

No new tests — these are pure layout components without existing test coverage. Manual testing covers them in Task 10.

- [ ] **Step 5.1: Update `TrackTags` to use absolute positioning**

Replace the body of `TrackTags` in `src/components/editor/timeline/track-tags.tsx`:

```tsx
export function TrackTags({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackTagsProps) {
  return (
    <div className="relative h-10 flex items-stretch">
      {timeline.map((s, i) => {
        const left = (s.startMs / 1000) * pxPerSecond;
        const width = (s.durationMs / 1000) * pxPerSecond;
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

The only change vs. the original: drop the `let cursor = 0; cursor += width;` accumulator. `left` now reads `s.startMs` directly.

- [ ] **Step 5.2: Update `TrackClips` to use absolute positioning**

Replace the body of `TrackClips` in `src/components/editor/timeline/track-clips.tsx`:

```tsx
export function TrackClips({ timeline, pxPerSecond, selectedIndex, onSelect }: TrackClipsProps) {
  return (
    <div className="relative h-[90px] flex items-stretch bg-muted/10">
      {timeline.map((section, i) => {
        const left = (section.startMs / 1000) * pxPerSecond;
        const width = (section.durationMs / 1000) * pxPerSecond;
        return (
          <div
            key={i}
            data-clip-block
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
                <ClipThumb
                  key={j}
                  thumbKey={c.fileId}
                  speedFactor={c.speedFactor}
                  trimDurationMs={c.trimDurationMs}
                  sectionMs={section.durationMs}
                />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
```

`ClipThumb` (helper at the bottom of the file) is unchanged.

- [ ] **Step 5.3: Update `TimelinePanel.totalMs` to be audio-bound**

In `src/components/editor/timeline/timeline-panel.tsx`, replace the `totalMs` `useMemo` (lines 41-46):

```tsx
const totalMs = useMemo(() => {
  const audioMs = audioDuration ? audioDuration * 1000 : 0;
  return Math.max(audioMs, overlaysMaxMs);
}, [audioDuration, overlaysMaxMs]);
```

Notice `timeline` no longer feeds `totalMs` — the audio file is the source of truth. Sections live inside `[0, audioDuration]` (parser bounds them), and overlays may extend slightly past the audio (existing behavior).

- [ ] **Step 5.4: Type-check + run all tests**

Run: `pnpm tsc --noEmit && pnpm test --run`
Expected: Type check clean, all tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/components/editor/timeline/track-tags.tsx src/components/editor/timeline/track-clips.tsx src/components/editor/timeline/timeline-panel.tsx
git commit -m "feat(timeline): position section blocks by absolute startMs

TrackTags and TrackClips read section.startMs directly instead of
cumulating durationMs. TimelinePanel.totalMs is bound to audioDuration
(plus any overlay extension), not the script content."
```

---

## Task 6: Thread `audioDuration` into `parseScript` callers

**Files:**
- Modify: `src/components/build/script-paste.tsx` (`ScriptPasteProps`, `handleParse`)

- [ ] **Step 6.1: Add `audioDurationMs` prop to ScriptPaste and pass through to parser**

In `src/components/build/script-paste.tsx`, update the props interface (lines 9-14):

```ts
interface ScriptPasteProps {
  text: string;
  onTextChange: (t: string) => void;
  availableBaseNames: Set<string>;
  audioDurationMs: number | null;
  onParsed: (sections: ParsedSection[], timeline: MatchedSection[]) => void;
}
```

Update the function signature (line 63):

```ts
export function ScriptPaste({ text, onTextChange, availableBaseNames, audioDurationMs, onParsed }: ScriptPasteProps) {
```

And update the parse call inside `handleParse` (line 69):

```ts
const result = parseScript(text, availableBaseNames, audioDurationMs);
```

- [ ] **Step 6.2: Pass the value from the only caller**

Find ScriptPaste's call site:

Run: `grep -rn "<ScriptPaste\b" src/ --include="*.tsx"`
Expected output: one or two callers (likely `script-dialog.tsx`).

For each caller, add `audioDurationMs={audioDuration ? audioDuration * 1000 : null}` to the JSX (where `audioDuration` is read from `useBuildState`). If the caller does not currently pull `audioDuration` from the context, add it to the destructured `useBuildState()` call.

Example expected change (in `src/components/editor/dialogs/script-dialog.tsx` or wherever ScriptPaste is rendered):

```tsx
const { /* existing fields */, audioDuration } = useBuildState();
// ...
<ScriptPaste
  text={scriptText}
  onTextChange={setScriptText}
  availableBaseNames={availableBaseNames}
  audioDurationMs={audioDuration ? audioDuration * 1000 : null}
  onParsed={handleParsed}
/>
```

- [ ] **Step 6.3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: Clean (the new required prop is supplied at every call site).

- [ ] **Step 6.4: Run full suite**

Run: `pnpm test --run`
Expected: All pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/build/script-paste.tsx src/components/editor/dialogs/script-dialog.tsx
git commit -m "feat(script-paste): thread audioDurationMs into parseScript

Parser's bound check now actually fires when a line's endTime exceeds
the loaded audio. Bound check is skipped when audio isn't loaded yet
(audioDurationMs === null)."
```

(Adjust the `git add` argument list if you found a different caller in step 6.2.)

---

## Task 7: Render API — gap-fill black segments

**Files:**
- Modify: `src/app/api/render/route.ts:11-145`

- [ ] **Step 7.1: Read `audioDurationMs` from FormData and validate**

Edit `src/app/api/render/route.ts`. Inside the `try` block in the `POST` handler, after reading `outputWidth`/`outputHeight`, add:

```ts
const audioDurationMsRaw = formData.get("audioDurationMs");
if (typeof audioDurationMsRaw !== "string") {
  return NextResponse.json({ error: "Missing audioDurationMs" }, { status: 400 });
}
const audioDurationMs = Number(audioDurationMsRaw);
if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
  return NextResponse.json({ error: "Invalid audioDurationMs" }, { status: 400 });
}
```

Place this immediately after the existing `outputWidth`/`outputHeight` validation (around line 36 in the original file).

- [ ] **Step 7.2: Define a constant for the minimum gap and a black-segment encoder helper**

Above the `POST` function in `src/app/api/render/route.ts`, add:

```ts
const FPS = 30;
const ONE_FRAME_MS = 1000 / FPS;

async function encodeBlackSegment(
  workDir: string,
  index: number,
  durationMs: number,
  outputWidth: number,
  outputHeight: number,
): Promise<string> {
  const segPath = path.join(workDir, `gap-${index}.ts`);
  await runFFmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${outputWidth}x${outputHeight}:r=${FPS}:d=${durationMs / 1000}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    segPath,
  ]);
  return segPath;
}
```

- [ ] **Step 7.3: Replace the segment-build loop with a sorted, gap-filling version**

Replace the existing block that builds `segments` (currently lines 56-105 of the file: the `for (let i = 0; i < parsed.length; i++)` loop and the empty-segments check below it). The new block:

```ts
// Sort defensively by absolute start, then walk through filling gaps with black.
const sortedTimeline = [...parsed].sort((a, b) => a.startMs - b.startMs);

const segments: string[] = [];
let cursor = 0;
let gapIndex = 0;

for (let i = 0; i < sortedTimeline.length; i++) {
  const section = sortedTimeline[i];
  if (!section || section.durationMs === 0) continue;

  // Leading gap before this section.
  const gapBefore = section.startMs - cursor;
  if (gapBefore >= ONE_FRAME_MS) {
    segments.push(await encodeBlackSegment(workDir, gapIndex++, gapBefore, outputWidth, outputHeight));
  }

  // Section's clip(s) — same encode logic as before.
  for (let j = 0; j < section.clips.length; j++) {
    const matched = section.clips[j];
    if (!matched) continue;
    const segPath = path.join(workDir, `seg-${i}-${j}.ts`);
    const sectionSec = section.durationMs / 1000;

    if (matched.isPlaceholder) {
      await runFFmpeg([
        "-y",
        "-f", "lavfi",
        "-i", `color=c=black:s=${outputWidth}x${outputHeight}:r=${FPS}:d=${sectionSec}`,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "fastdecode",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        "-f", "mpegts",
        segPath,
      ]);
    } else {
      const inputPath = clipsByFileId.get(matched.fileId);
      if (!inputPath) continue;
      await runFFmpeg([
        "-y",
        "-i", inputPath,
        ...(matched.trimDurationMs ? ["-t", String(matched.trimDurationMs / 1000)] : []),
        "-vf",
        `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2,` +
        `setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
        "-an",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "fastdecode",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        "-f", "mpegts",
        segPath,
      ]);
    }
    segments.push(segPath);
  }

  cursor = section.endMs;
}

// Trailing gap to fill out the audio length.
const trailing = audioDurationMs - cursor;
if (trailing >= ONE_FRAME_MS) {
  segments.push(await encodeBlackSegment(workDir, gapIndex++, trailing, outputWidth, outputHeight));
}

if (segments.length === 0) {
  // Audio with no script content at all → encode one full-length black segment.
  segments.push(await encodeBlackSegment(workDir, 0, audioDurationMs, outputWidth, outputHeight));
}
```

The existing concat/mux block below (`writeFile concatListPath`, `runFFmpeg([... -i concatListPath -i audioPath -c:v copy -c:a aac -shortest output.mp4])`) is unchanged.

- [ ] **Step 7.4: Update the request type interface**

Update lines 12-16 of `route.ts`:

```ts
interface RenderRequest {
  timeline: MatchedSection[];
  outputWidth: number;
  outputHeight: number;
  audioDurationMs: number;
}
```

- [ ] **Step 7.5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: Clean.

- [ ] **Step 7.6: Run tests**

Run: `pnpm test --run`
Expected: All pass.

- [ ] **Step 7.7: Commit**

```bash
git add src/app/api/render/route.ts
git commit -m "feat(api/render): pad gaps with black, render full audio length

Sort timeline by startMs, encode black MPEG-TS segments for the leading
gap, every inter-section gap, and the trailing gap up to audioDurationMs.
Removes the empty-timeline error — audio + no script now produces a
full-length black-only video instead of a 400."
```

---

## Task 8: Render trigger — pass `audioDurationMs` to API

**Files:**
- Modify: `src/components/build/render-trigger.tsx:14`, `src/components/build/render-trigger.tsx:43-92` (`startRender`)

- [ ] **Step 8.1: Add audioDurationMs to props**

Edit `src/components/build/render-trigger.tsx`. Update the props interface (line 9-12):

```ts
interface RenderTriggerProps {
  audioFile: File;
  audioDurationMs: number;
  timeline: MatchedSection[];
}
```

Destructure it from props (line 14):

```ts
export function RenderTrigger({ audioFile, audioDurationMs, timeline }: RenderTriggerProps) {
```

In `startRender`, after `fd.append("outputHeight", String(outputSize.height));`, add:

```ts
fd.append("audioDurationMs", String(audioDurationMs));
```

- [ ] **Step 8.2: Find and update the only caller**

Run: `grep -rn "<RenderTrigger\b" src/ --include="*.tsx"`
Expected: a single render-trigger consumer.

In that caller, add `audioDurationMs={audioDuration ? audioDuration * 1000 : 0}` (or assert non-null with a guard if the existing pattern requires `audioFile` to be defined — `RenderTrigger` already guards rendering on a non-null audio, so `audioDuration` is also non-null at that point).

If the existing call already destructures `audioDuration` from `useBuildState`, just append the new prop. If not, add `audioDuration` to the destructure.

- [ ] **Step 8.3: Type-check + run tests**

Run: `pnpm tsc --noEmit && pnpm test --run`
Expected: Clean, all pass.

- [ ] **Step 8.4: Commit**

```bash
git add src/components/build/render-trigger.tsx <caller-file>
git commit -m "feat(render-trigger): pass audioDurationMs to /api/render

The server uses it to pad the rendered video out to full audio length."
```

(Replace `<caller-file>` with the path you found in step 8.2.)

---

## Task 9: Manual smoke test in the browser

No code changes — this validates the user-visible behavior the unit tests can't reach.

- [ ] **Step 9.1: Start the dev server**

Run: `pnpm dev`
Open the editor in a browser; load a 5+ minute audio file and a folder of B-roll clips that cover at least the `cta` tag.

- [ ] **Step 9.2: Single-line script at a late timestamp**

In the script dialog, paste exactly:

```
00:05:10,640 --> 00:05:14,280 || cta || click below and finally make nail trims something your dog won't dread.
```

Click Parse → Apply.

Expected:
- The broll block on `TrackTags` and `TrackClips` is positioned near the right edge of the timeline (around the 5:10 mark relative to the 5:15 audio).
- Pressing Play from the start renders **black for ~5:10**, then the broll appears at 5:10 and runs through 5:14.
- After 5:14, black again until the audio ends at 5:15.

- [ ] **Step 9.3: Multi-line script with gaps**

Replace the script with:

```
00:00:05,000 --> 00:00:10,000 || cta || first
00:00:20,000 --> 00:00:25,000 || cta || second
00:01:00,000 --> 00:01:05,000 || cta || third
```

Expected: three broll blocks spaced apart on the timeline at 0:05, 0:20, 1:00. Gaps between them play black + audio.

- [ ] **Step 9.4: Overlap → error**

Replace with:

```
00:00:05,000 --> 00:00:10,000 || cta || first
00:00:08,000 --> 00:00:14,000 || cta || overlaps first
```

Expected: parser shows a red error mentioning line 2 overlapping line 1. Apply button is disabled.

- [ ] **Step 9.5: Beyond audio end → error**

Replace with (assuming a 5:15 audio):

```
00:05:00,000 --> 00:06:00,000 || cta || past end
```

Expected: parser error mentioning line 1's end exceeds the audio duration.

- [ ] **Step 9.6: Empty script + audio loaded**

Clear the script entirely so the timeline is empty. Click Render.

Expected: the API returns a full-audio-length MP4 (open in VLC) that is entirely black with the audio playing.

- [ ] **Step 9.7: Single line + render**

Restore the Step 9.2 script. Click Render. When the download arrives, open it in VLC.

Expected:
- Total length = audio length (~5:15).
- Black for the first ~5:10, then the broll, then black again for ~1 second to the end.
- Audio plays cleanly the whole way.

- [ ] **Step 9.8: Locked broll re-paste with shifted timestamp**

In the editor, click a section, lock its picks (the existing lock UI). Then in the script dialog, change just that line's timestamp (move it later in the audio without changing the duration). Re-parse + apply.

Expected: the lock badge stays on that section; the same clip(s) are bound; the section block is repositioned to the new absolute timestamp.

---

## Self-Review

**Spec coverage check (run yourself before declaring done):**

| Spec section | Implemented in task |
|---|---|
| Decision 1: gaps render as black + audio | Tasks 7, 9.2/9.3 |
| Decision 2: overlapping lines = parser error | Task 2, 9.4 |
| Decision 3: total length = audioDuration | Tasks 5.3 (editor), 7 (render), 9.6/9.7 |
| Decision 4: startMs/endMs on MatchedSection | Task 1 |
| 4.1 data model change | Task 1 |
| 4.2 editor timeline rendering | Task 5.1, 5.2 |
| 4.3 playback plan | Task 3 |
| 4.4 lock-preserve | Task 4 |
| 4.5 parser validation | Task 2, 6 (caller threading) |
| 4.6 render pipeline | Task 7, 8 |

All spec sections covered.

**Type consistency check:**
- `MatchedSection.startMs / endMs` — integer milliseconds, used identically in tasks 1, 3, 4, 5, 7.
- `parseScript(..., audioDurationMs: number | null)` — same signature in Task 2 (definition), Task 6 (caller).
- API FormData key is `audioDurationMs` in Task 7 (server read) and Task 8 (client send).

No drift detected.
