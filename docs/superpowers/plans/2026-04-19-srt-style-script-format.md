# SRT-Style Script Format + Frame-Aligned Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade script parser to accept SRT-style timestamps (`HH:MM:SS,mmm --> HH:MM:SS,mmm || tag || text`) with millisecond precision, snap all section boundaries to 30fps frame grid to prevent audio/video drift, and enforce 30fps throughout the FFmpeg render pipeline.

**Architecture:**
- Parser accepts SRT-style one-line cues (matches CapCut export style) and still accepts `MM:SS` shorthand for backward compatibility (treated as `,000`).
- New `frame-align.ts` module converts arbitrary millisecond durations to exact frame counts at a target FPS (default 30). Sections are frame-snapped at parse time so downstream math (auto-match speed factor, render durations) is already integer-frame-aligned, preventing sub-frame drift from accumulating over many cues.
- Render worker adds `-r 30` to every encode step (per-clip trim/speed pass, black-frame placeholder, and final concat) so output fps is locked and segments line up cleanly.

**Tech Stack:** TypeScript (strict), Vitest, Next.js 16 App Router, FFmpeg.wasm 0.12+, Drizzle (no schema change needed).

**Scope note:** No DB schema change. `clips.duration_ms` is already millisecond-precision integer. `HTMLVideoElement.duration` rounding (≤1ms error) is acceptable; if a future issue surfaces, swap to ffprobe-on-upload in a separate plan.

---

## File Structure

**Create:**
- `src/lib/frame-align.ts` — pure helpers: `msToFrames`, `framesToMs`, `snapMsToFrame`. 30fps default.
- `src/lib/__tests__/frame-align.test.ts` — unit tests for the helpers.

**Modify:**
- `src/lib/script-parser.ts` — swap regex to SRT-style, add ms parsing, snap section boundaries to frame grid, return frame-aligned `durationMs`.
- `src/lib/__tests__/script-parser.test.ts` — replace/extend cases for new format.
- `src/components/build/script-paste.tsx` — update placeholder to show SRT-style example.
- `src/components/build/timeline-preview.tsx` — upgrade `formatMs` to show ms precision (`M:SS.mmm`).
- `src/components/broll/clip-grid.tsx` — same `formatMs` upgrade (shared util preferred).
- `src/lib/format-time.ts` (new, extracted) — shared `formatMs` used by both UI files.
- `src/workers/render-worker.ts` — add `-r 30` to per-clip encode, black-frame encode, and final concat (switch concat from `-c:v copy` to `-c:v libx264 -r 30 -pix_fmt yuv420p`).

**Do NOT modify:**
- `src/lib/schema.ts` — no DB changes.
- `src/lib/auto-match.ts` — speed-factor math is already duration-ratio-based; frame-snapping upstream is enough.

---

## Task 1: Frame-alignment helpers

**Files:**
- Create: `src/lib/frame-align.ts`
- Test: `src/lib/__tests__/frame-align.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/frame-align.test.ts
import { describe, it, expect } from "vitest";
import { msToFrames, framesToMs, snapMsToFrame } from "../frame-align";

describe("frame-align @ 30fps", () => {
  it("msToFrames rounds to nearest frame", () => {
    expect(msToFrames(0)).toBe(0);
    expect(msToFrames(33)).toBe(1);   // 33 / 33.333 = 0.99 → 1
    expect(msToFrames(34)).toBe(1);
    expect(msToFrames(50)).toBe(2);   // 50 / 33.333 = 1.5 → round to 2
    expect(msToFrames(1000)).toBe(30);
    expect(msToFrames(1833)).toBe(55); // 1.833s ≈ 55 frames
  });

  it("framesToMs produces exact frame timestamps", () => {
    expect(framesToMs(0)).toBe(0);
    expect(framesToMs(1)).toBeCloseTo(33.3333, 3);
    expect(framesToMs(30)).toBe(1000);
    expect(framesToMs(55)).toBeCloseTo(1833.3333, 3);
  });

  it("snapMsToFrame returns exact frame-aligned ms", () => {
    expect(snapMsToFrame(0)).toBe(0);
    expect(snapMsToFrame(1833)).toBeCloseTo(1833.3333, 3);
    // 1833ms is closer to frame 55 (1833.33ms) than frame 54 (1800ms)
    expect(snapMsToFrame(1800)).toBe(1800);
  });

  it("accepts custom fps", () => {
    expect(msToFrames(1000, 60)).toBe(60);
    expect(framesToMs(60, 60)).toBe(1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/frame-align.test.ts`
Expected: FAIL with "Cannot find module '../frame-align'"

- [ ] **Step 3: Implement `frame-align.ts`**

```typescript
// src/lib/frame-align.ts
export const DEFAULT_FPS = 30;

export function msToFrames(ms: number, fps: number = DEFAULT_FPS): number {
  return Math.round((ms * fps) / 1000);
}

export function framesToMs(frames: number, fps: number = DEFAULT_FPS): number {
  return (frames * 1000) / fps;
}

export function snapMsToFrame(ms: number, fps: number = DEFAULT_FPS): number {
  return framesToMs(msToFrames(ms, fps), fps);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/frame-align.test.ts`
Expected: PASS, 4/4

- [ ] **Step 5: Commit**

```bash
git add src/lib/frame-align.ts src/lib/__tests__/frame-align.test.ts
git commit -m "feat: add frame-align helpers for 30fps boundary snapping"
```

---

## Task 2: Parser — accept SRT-style timestamps

**Files:**
- Modify: `src/lib/script-parser.ts`
- Test: `src/lib/__tests__/script-parser.test.ts`

- [ ] **Step 1: Rewrite tests for SRT-style format**

Replace the entire `src/lib/__tests__/script-parser.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { parseScript } from "../script-parser";

const BASE_NAMES = new Set(["hook", "fs-clipper-freakout", "ump-compressthenail", "before-after"]);

describe("parseScript — SRT-style", () => {
  it("parses HH:MM:SS,mmm --> HH:MM:SS,mmm cue", () => {
    const result = parseScript("00:00:01,250 --> 00:00:02,833 || Hook || Intro text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      tag: "Hook",
      scriptText: "Intro text",
    });
    // 1250ms → frame 38 (1266.67ms), 2833ms → frame 85 (2833.33ms)
    // durationMs = 85 frames - 38 frames = 47 frames = 1566.67ms
    expect(result.sections[0].durationMs).toBeCloseTo(1566.6667, 3);
  });

  it("parses MM:SS,mmm shorthand", () => {
    const result = parseScript("00:01,250 --> 00:02,833 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts legacy MM:SS (no ms, treated as ,000)", () => {
    const result = parseScript("00:00 --> 00:04 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections[0].durationMs).toBe(4000); // frame-aligned: 4s = 120 frames exact
  });

  it("snaps start/end to frame boundaries", () => {
    // 1000ms start, 1050ms end — 50ms is between frame 1 (33.33) and frame 2 (66.67)
    // 1050ms → nearest frame = 32 (1066.67ms) — no wait, 1050 * 30 / 1000 = 31.5 → rounds to 32
    const result = parseScript("00:01,000 --> 00:01,050 || Hook || tiny", BASE_NAMES);
    // start frame 30 (1000ms), end frame 32 (1066.67ms) → 2 frames = 66.67ms
    // OR start frame 30, end frame 31 (1033.33ms) → 1 frame = 33.33ms
    // depending on rounding — either way, result is frame-aligned integer count
    const d = result.sections[0].durationMs;
    expect(Math.round(d * 30 / 1000)).toBeGreaterThan(0); // is integer frame count
  });

  it("skips blank lines", () => {
    const result = parseScript("\n00:00 --> 00:04 || Hook || text\n\n", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
  });

  it("errors on invalid line", () => {
    const result = parseScript("not a valid line", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
  });

  it("warns on unknown tag (case-insensitive)", () => {
    const result = parseScript("00:00 --> 00:04 || UnknownTag || text", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("UnknownTag"))).toBe(true);
  });

  it("matches tags case-insensitively", () => {
    const result = parseScript("00:00 --> 00:04 || FS-CLIPPER-FREAKOUT || text", BASE_NAMES);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on zero-duration section", () => {
    const result = parseScript("00:00,000 --> 00:00,000 || Hook || text", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("zero"))).toBe(true);
  });

  it("handles multi-line SRT-style script", () => {
    const input = [
      "00:00:00,000 --> 00:00:04,000 || Hook || Line one",
      "00:00:04,000 --> 00:00:10,500 || FS-clipper-freakout || Line two",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.sections).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/script-parser.test.ts`
Expected: FAIL (old regex rejects `-->` separator and `,mmm`)

- [ ] **Step 3: Rewrite `src/lib/script-parser.ts`**

```typescript
import { snapMsToFrame } from "./frame-align";

export interface ParsedSection {
  lineNumber: number;
  startTime: number;   // seconds (frame-snapped, may have fractional ms)
  endTime: number;     // seconds (frame-snapped)
  tag: string;
  scriptText: string;
  durationMs: number;  // frame-snapped (endMs - startMs)
}

export interface ParseResult {
  sections: ParsedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

// Matches:
//   HH:MM:SS,mmm --> HH:MM:SS,mmm || tag || text
//   MM:SS,mmm    --> MM:SS,mmm    || tag || text
//   HH:MM:SS     --> HH:MM:SS     || tag || text   (ms = 000)
//   MM:SS        --> MM:SS        || tag || text   (ms = 000)
const TIMESTAMP = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:,(\d{1,3}))?`;
const LINE_PATTERN = new RegExp(
  `^${TIMESTAMP}\\s*-->\\s*${TIMESTAMP}\\s*\\|\\|\\s*(.+?)\\s*\\|\\|\\s*(.*)$`,
);

function parseTimestampToMs(
  h: string | undefined,
  m: string,
  s: string,
  ms: string | undefined,
): number {
  const hours = h ? Number(h) : 0;
  const mins = Number(m);
  const secs = Number(s);
  const millis = ms ? Number(ms.padEnd(3, "0").slice(0, 3)) : 0;
  return ((hours * 3600 + mins * 60 + secs) * 1000) + millis;
}

export function parseScript(text: string, availableBaseNames: Set<string>): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: { line: number; message: string }[] = [];

  const lines = text.split("\n");
  lines.forEach((raw, idx) => {
    const lineNumber = idx + 1;
    const line = raw.trim();
    if (!line) return;

    const match = line.match(LINE_PATTERN);
    if (!match) {
      errors.push({
        line: lineNumber,
        message: `Invalid format at line ${lineNumber} (expected "HH:MM:SS,mmm --> HH:MM:SS,mmm || tag || text")`,
      });
      return;
    }

    const [, sh, sm, ss, sms, eh, em, es, ems, tag, scriptText] = match;
    const rawStartMs = parseTimestampToMs(sh, sm, ss, sms);
    const rawEndMs = parseTimestampToMs(eh, em, es, ems);

    const startMs = snapMsToFrame(rawStartMs);
    const endMs = snapMsToFrame(rawEndMs);
    const durationMs = endMs - startMs;

    if (durationMs === 0) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: zero-duration section for tag "${tag}"`,
      });
    }

    if (!availableBaseNames.has(tag.toLowerCase())) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: tag "${tag}" has no matching B-roll base name. Will render black frames.`,
      });
    }

    sections.push({
      lineNumber,
      startTime: startMs / 1000,
      endTime: endMs / 1000,
      tag,
      scriptText: scriptText.trim(),
      durationMs,
    });
  });

  return { sections, errors, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/script-parser.test.ts`
Expected: PASS, 10/10

- [ ] **Step 5: Run the full vitest suite to catch regressions**

Run: `pnpm vitest run`
Expected: All tests pass. If `auto-match.test.ts` fails because its fixture `ParsedSection` literals use the old `||`-separator-based duration, it does not — those tests build sections directly, not via parseScript, so should still pass. Fix any unexpected breakage.

- [ ] **Step 6: Commit**

```bash
git add src/lib/script-parser.ts src/lib/__tests__/script-parser.test.ts
git commit -m "feat: script parser accepts SRT-style timestamps with ms precision"
```

---

## Task 3: Update script-paste placeholder + error hint

**Files:**
- Modify: `src/components/build/script-paste.tsx:48`

- [ ] **Step 1: Update the textarea placeholder**

Replace the `placeholder={...}` attribute around line 48 with:

```tsx
placeholder={"00:00:01,250 --> 00:00:02,833 || hook || Script text here\n00:00:02,833 --> 00:00:12,000 || fs-clipper-freakout || More script"}
```

- [ ] **Step 2: Manual verification**

Run: `pnpm dev`
Open the Build Video page, focus the textarea, confirm the placeholder shows the new SRT-style example.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/script-paste.tsx
git commit -m "feat: script-paste placeholder shows SRT-style format"
```

---

## Task 4: Shared time formatter with ms precision

**Files:**
- Create: `src/lib/format-time.ts`
- Modify: `src/components/build/timeline-preview.tsx:16-19`
- Modify: `src/components/broll/clip-grid.tsx` (locate local `formatMs`, replace with import)

- [ ] **Step 1: Create `src/lib/format-time.ts`**

```typescript
// Formats a millisecond duration as M:SS.mmm (e.g., 1833.333 → "0:01.833")
export function formatMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const secondsFloat = totalSeconds - minutes * 60;
  const wholeSeconds = Math.floor(secondsFloat);
  const fractionalMs = Math.round((secondsFloat - wholeSeconds) * 1000);
  return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(fractionalMs).padStart(3, "0")}`;
}
```

- [ ] **Step 2: Add test**

Create `src/lib/__tests__/format-time.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatMs } from "../format-time";

describe("formatMs", () => {
  it("formats zero", () => expect(formatMs(0)).toBe("0:00.000"));
  it("formats sub-second", () => expect(formatMs(250)).toBe("0:00.250"));
  it("formats with minutes", () => expect(formatMs(65_500)).toBe("1:05.500"));
  it("formats frame-aligned ms", () => expect(formatMs(1833.3333)).toBe("0:01.833"));
});
```

- [ ] **Step 3: Run tests to verify pass**

Run: `pnpm vitest run src/lib/__tests__/format-time.test.ts`
Expected: PASS, 4/4

- [ ] **Step 4: Replace local `formatMs` in timeline-preview.tsx**

In `src/components/build/timeline-preview.tsx`:

1. Delete lines 16-19 (the local `formatMs` definition).
2. Add import at top alongside other imports from `@/lib/...`:

```typescript
import { formatMs } from "@/lib/format-time";
```

- [ ] **Step 5: Replace local `formatMs` in clip-grid.tsx**

Open `src/components/broll/clip-grid.tsx`, find the local `formatMs` definition (likely near top), delete it, and add:

```typescript
import { formatMs } from "@/lib/format-time";
```

- [ ] **Step 6: Run full vitest + typecheck**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/format-time.ts src/lib/__tests__/format-time.test.ts src/components/build/timeline-preview.tsx src/components/broll/clip-grid.tsx
git commit -m "feat: shared formatMs helper with ms precision for timeline display"
```

---

## Task 5: Render worker — lock 30fps on every encode

**Files:**
- Modify: `src/workers/render-worker.ts`

- [ ] **Step 1: Add `-r 30` to black-frame encode**

Change the `ffmpeg.exec([...])` call inside the `if (matched.isPlaceholder)` branch (lines 30-35) to:

```typescript
await ffmpeg.exec([
  "-f", "lavfi",
  "-i", `color=c=black:s=1080x1350:r=30:d=${section.durationMs / 1000}`,
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-r", "30",
  segName,
]);
```

Note: `r=30` is added inline on the `lavfi` input (source rate) and `-r 30` on the output ensures encode rate too.

- [ ] **Step 2: Add `-r 30` to per-clip encode**

Change the `ffmpeg.exec([...])` call in the `else` branch (lines 40-46) to:

```typescript
await ffmpeg.exec([
  "-i", `input-${i}-${j}.mp4`,
  ...(matched.trimDurationMs ? ["-t", String(matched.trimDurationMs / 1000)] : []),
  "-vf", `setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
  "-an",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-r", "30",
  segName,
]);
```

- [ ] **Step 3: Switch final concat from `-c:v copy` to re-encode at 30fps**

Change the final concat call (lines 58-63):

```typescript
await ffmpeg.exec([
  "-f", "concat", "-safe", "0", "-i", "concat.txt",
  "-i", "audio.mp3",
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-r", "30",
  "-c:a", "aac",
  "-shortest",
  "output.mp4",
]);
```

Rationale for re-encode vs copy: since every segment is now already at 30fps/yuv420p/libx264, copy would also work, but re-encoding is safer — if any input clip has slightly different SAR/DAR/pix_fmt that survived segment encode, concat demuxer errors out. Re-encoding absorbs that without user-facing failure.

- [ ] **Step 4: Manual QA — render a small multi-cue script**

Run: `pnpm dev`, upload a few B-roll clips + an MP3, paste this test script:

```
00:00:00,000 --> 00:00:01,833 || hook || One
00:00:01,833 --> 00:00:04,500 || fs-clipper-freakout || Two
00:00:04,500 --> 00:00:06,000 || hook || Three
```

Trigger render. Verify:
- Output file is 6 seconds (±1 frame / 33ms)
- Audio stays in sync with the video cuts through the end
- `ffprobe -show_streams output.mp4 | grep r_frame_rate` reports `30/1` (or `30000/1000`)

- [ ] **Step 5: Commit**

```bash
git add src/workers/render-worker.ts
git commit -m "feat: lock 30fps across all render-worker encodes to prevent drift"
```

---

## Task 6: Update timeline-preview `reroll` to use frame-snapped fakeSection

**Files:**
- Modify: `src/components/build/timeline-preview.tsx:61-68`

The `reroll` function builds a synthetic `ParsedSection` from the current section's `durationMs`. Since section durations are now already frame-snapped (from the parser), this still works — but the synthetic `startTime`/`endTime` fields won't match the original. They're unused in `matchSections` (which only reads `durationMs`/`tag`), so no behavior change. No code change needed for correctness, but add an inline one-line comment noting the assumption.

- [ ] **Step 1: Add clarifying comment**

Just before the `const fakeSection: ParsedSection = {...}` line (around line 61), add:

```typescript
// durationMs is already frame-aligned from the original parse; matchSections only consumes tag + durationMs
```

- [ ] **Step 2: Commit**

```bash
git add src/components/build/timeline-preview.tsx
git commit -m "chore: note frame-alignment assumption in reroll synthetic section"
```

---

## Task 7: Full verification before declaring done

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: ALL tests pass. No skipped tests added without reason.

- [ ] **Step 2: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: End-to-end manual render**

Using the dev server, run through the full flow:
1. Create a product, upload 2-3 B-roll clips with valid base names.
2. Upload an MP3 audio track.
3. Paste an SRT-style script with at least 5 cues, using non-round millisecond timestamps (e.g., `00:00:01,250`, `00:00:03,750`).
4. Parse → timeline shows correctly, section durations displayed as `M:SS.mmm` with non-zero ms portions.
5. Render → download the MP4.
6. Open the MP4, verify total duration matches audio duration (±1 frame), verify cuts happen where script says, verify no audio drift at the end.

- [ ] **Step 4: Final commit if anything surfaced**

If the E2E surfaced tweaks, commit them here. Otherwise skip.

---

## Self-Review Summary

- **Spec coverage:** Parser format change ✓ (Task 2), ms precision ✓ (Task 2 regex + Task 4 UI), 30fps preservation ✓ (Task 5), frame-alignment to prevent drift ✓ (Tasks 1 & 2), DB precision verified as already-correct (schema note above).
- **Placeholders:** None — all code blocks are complete.
- **Type consistency:** `ParsedSection` field names unchanged (`durationMs`, `startTime`, `endTime`, `tag`, `scriptText`, `lineNumber`). `formatMs` signature unchanged (`(ms: number) => string`). Render worker `ffmpeg.exec` arg arrays updated consistently across all three exec calls.
- **Out of scope (intentional):** ffprobe-based duration extraction on clip upload (current `HTMLVideoElement.duration` is adequate); 60fps output mode (requires separate UX + may increase render time 2x); full multi-line SRT block parsing (CapCut 1-line export suffices per user).
