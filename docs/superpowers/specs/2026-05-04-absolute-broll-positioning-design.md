# Absolute B-roll Positioning on the Audio Timeline

Date: 2026-05-04

## Problem

The script format already encodes absolute timestamps per line:
`HH:MM:SS,mmm --> HH:MM:SS,mmm || tag || text`

But every component downstream of the parser collapses sections into a contiguous chain that starts at `t = 0`:

- `matchSections` returns `MatchedSection` whose only timing field is `durationMs`. The `startTime` / `endTime` carried by `ParsedSection` is dropped.
- `TrackTags` ([src/components/editor/timeline/track-tags.tsx](../../src/components/editor/timeline/track-tags.tsx)) and `TrackClips` ([src/components/editor/timeline/track-clips.tsx](../../src/components/editor/timeline/track-clips.tsx)) lay out blocks by accumulating `cursor += duration` from `0`.
- `playback-plan` computes `audioStartMs` as the cumulative duration of preceding sections.
- The render worker and render API encode each section as an MPEG-TS segment and concat them end-to-end, so the output is `Σ section.durationMs` long, not the audio length.

Result: a single script line at `00:05:10,640 --> 00:05:14,280` on a 5:15 audio file shows up at position `0:00` in the editor and in the rendered MP4. The user expects it at `5:10`.

## Goals

1. Each B-roll appears at the absolute timestamp specified by its script line — in the editor preview, in the playback player, and in the rendered MP4.
2. Each script line is independent. Whether neighboring lines have brolls or not has no effect on placement.
3. The audio file is the source of truth for total length. The rendered video is exactly `audioDuration` long, regardless of how many script lines exist.

## Non-Goals

- Drag-to-reposition brolls on the timeline.
- Snap-to-grid when typing timestamps.
- Auto-extending a broll across a gap to the next scripted region.
- Server-side audio probing — the client already has `audioDuration` and can pass it through.

## Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Gaps between scripted regions render as **black frame + audio playing**. | Canonical VSL pattern, makes missing-broll obvious, simplest render pipeline. |
| 2 | Two script lines whose time ranges overlap are a **parser error**, not a runtime resolution. | No ambiguous behavior; SRT format also disallows overlap; user must fix the script. |
| 3 | Total timeline / video length is always **`audioDuration`**, never derived from the script. | Audio is the source of truth in a VSL workflow; the user uploads what they want, the script lays brolls on top. |
| 4 | Absolute positioning is stored on `MatchedSection` itself (new `startMs` / `endMs` fields), not computed on the fly. | Single source of truth; one serialization path covers editor, preview, and render. |

## Architecture Changes

### 4.1 Data model

**`src/lib/auto-match.ts`** — extend `MatchedSection`:

```ts
export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  startMs: number;   // NEW: absolute position on audio timeline
  endMs: number;     // NEW: startMs + durationMs (precomputed for consumer convenience)
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
  userLocked?: boolean;
}
```

`matchSections` reads `section.startTime * 1000` and `section.endTime * 1000` from the input `ParsedSection` and assigns them through. No new computation.

### 4.2 Editor timeline rendering

**`track-tags.tsx`**, **`track-clips.tsx`**: drop the cumulative `cursor` variable. Position each block from `section.startMs` directly:

```ts
const left = (section.startMs / 1000) * pxPerSecond;
const width = (section.durationMs / 1000) * pxPerSecond;
```

The container width in `timeline-panel.tsx` is already driven by `audioDuration`, so the timeline already spans the full audio — no change there.

### 4.3 Playback plan

**`src/lib/playback-plan.ts`**:

- `buildSectionPlaybackPlan`: `audioStartMs = section.startMs` (read directly; remove the cumulative reduce on lines 44-46).
- `buildFullTimelinePlaybackPlan`: clip `startMs` becomes `section.startMs + (slot * clipIndex)`. Drop the running `cursor` accumulator.
- `findSectionAtMs`: scan for a section where `ms ∈ [section.startMs, section.endMs)`. Return `null` when no section covers `ms` (= gap → player renders black).

### 4.4 Lock-preserve

**`src/lib/lock-preserve.ts`**: the sequential queue-matching logic (tag + duration tolerance) is unchanged. When constructing the preserved entry, take timing from the new `ns: ParsedSection` (not the old locked section): `startMs: ns.startTime * 1000`, `endMs: ns.endTime * 1000`. Same conversion `matchSections` performs. A re-pasted line that moved in time still binds the same picks at its new position.

### 4.5 Parser validation

**`src/lib/script-parser.ts`** — add two new error rules and one signature change:

```ts
export function parseScript(
  text: string,
  availableBaseNames: Set<string>,
  audioDurationMs: number | null,   // NEW (nullable: audio may not be loaded yet)
): ParseResult { ... }
```

After parsing all lines:

1. **Overlap check.** Sort accepted sections by `startMs`. For each adjacent pair, if `curr.startMs < prev.endMs`, push an error pointing at `curr.lineNumber`.
2. **Bound check.** When `audioDurationMs !== null`, for each section: if `endMs > audioDurationMs`, push an error.

Existing rules (`endTime < startTime`, zero-duration warning, unknown tag warning) are preserved.

Callers in `script-paste.tsx` and `build-state-context.tsx` re-run `parseScript` whenever `audioDuration` changes (already follows React dependency-array pattern), so a script pasted before audio loads will get re-validated.

### 4.6 Render pipeline (worker + native API)

Both `src/workers/render-worker.ts` and `src/app/api/render/route.ts` use the same logical pipeline: encode each section to an MPEG-TS segment → concat with `-c copy` → mux audio. The change is identical in both places.

**Algorithm:**

```
sort timeline by startMs (defensive)
cursor = 0
queue = []
for section in timeline:
  gap = section.startMs - cursor
  if gap >= one_frame_ms:
    queue.push(encode_black_segment(gap))
  for clip in section.clips:
    queue.push(encode_clip_segment(clip, section))   # existing logic
  cursor = section.endMs
trailing = audioDurationMs - cursor
if trailing >= one_frame_ms:
  queue.push(encode_black_segment(trailing))
concat(queue) + mux(audio)                            # existing logic
```

`encode_black_segment` reuses the placeholder branch already present in both files (lavfi `color=c=black:s=WxH:r=30`).

**`audioDurationMs` plumbing:**

- Client `RenderTrigger` already has `audioDuration` from `useBuildState`. Append `audioDurationMs` to the FormData sent to `/api/render`. For the browser-side worker path (if still used), include it in the `cmd: "render"` postMessage.
- API route reads it from `formData.get("audioDurationMs")` and validates it's a positive finite number.

**Empty timeline edge:** the early-return error `"Timeline produced no renderable segments"` ([route.ts:107](../../src/app/api/render/route.ts#L107)) is removed. With audio present, the pipeline now produces a full-length black-only video, which is the correct fallback under the new model.

**Sub-frame gaps:** at 30fps the smallest representable gap is `1000/30 ≈ 33.33ms`. Gaps below that are skipped — adjacent sections render as if contiguous. Audio drift below one frame is imperceptible, and `snapMsToFrame` already aligns parsed timestamps to frame boundaries, so this case is rare.

## Test Plan

### Unit tests (vitest, existing patterns)

| File | New cases |
|---|---|
| `src/lib/__tests__/auto-match.test.ts` | `MatchedSection.startMs` / `endMs` copied from `ParsedSection.startTime / endTime` |
| `src/lib/__tests__/playback-plan.test.ts` | `audioStartMs === section.startMs` (not cumulative); `findSectionAtMs` returns `null` in gaps; full-timeline plan emits clips with absolute `startMs` |
| `src/lib/__tests__/script-parser.test.ts` (new file or extend) | Overlap → error on later line; touching ranges (no gap, `curr.startMs === prev.endMs`) → OK; `endMs > audioDurationMs` → error; `audioDurationMs === null` → bound check skipped |
| `src/lib/__tests__/lock-preserve.test.ts` | Preserved entry takes `startMs` / `endMs` from new `ns`, not old locked section |

### Manual browser tests

- Paste single line `00:05:10,640 --> 00:05:14,280` on 5:15 audio → broll block at `5:10` in `TrackTags` and `TrackClips`; preview plays black until `5:10`; MP4 export verified in VLC has the broll at `5:10` and total length `5:15`.
- Multi-line script with gaps between lines → gaps are black, brolls at correct positions.
- Overlapping lines → `script-dialog` shows the overlap error.
- Line with `endMs > audioDurationMs` → error.
- Lock a section, re-paste the same script with that line shifted in time → lock is preserved at the new position.
- Empty script + audio loaded → render produces a full-audio-length black video.

## Risks

1. **Audio not yet loaded when user pastes script.** `audioDurationMs` is `null` in `parseScript` so the bound check is skipped. Caller must re-parse when `audioDuration` becomes non-null. Existing dependency-array pattern handles this.
2. **Sub-frame gaps producing empty segments.** Skip gaps shorter than one frame at 30fps (`< 33.33ms`).
3. **Many tiny gaps inflating segment count.** Each gap adds one segment to the concat tree. Black segment encoding is fast (lavfi). No expected impact on practical script sizes (<200 lines).
4. **Sections out of chronological order in the JSON sent to the render API.** Defensive sort by `startMs` in render code rather than trusting client order.
5. **`-shortest` flag interaction.** Video and audio now have equal length by construction, so `-shortest` is a no-op. Keep it as belt-and-suspenders.

## Out of Scope

- Drag-to-reposition or resize brolls visually on the timeline.
- Snap-to-grid timestamps when typing.
- Auto-extending or auto-filling brolls across gaps.
- Server-side audio probing via `ffprobe`.
