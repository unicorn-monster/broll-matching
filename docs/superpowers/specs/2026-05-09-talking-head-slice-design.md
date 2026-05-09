# Talking-Head Auto-Slice — Design

Date: 2026-05-09
Status: Approved (brainstorm), pending implementation plan.

## Problem

Current pipeline auto-assembles VSLs from script + B-roll library, but sections tagged as
talking-head (face-cam, e.g. `ugc-head`) have no B-roll variants — they render as black
placeholders. The user manually opens the rendered MP4 in CapCut, lays a long talking-head
recording on a second track, and cuts it down to the placeholder slots. We want to automate
that step.

## Constraint contract from the user

- Talking-head MP4 is **silent** (audio stripped before upload).
- Talking-head MP4 duration **equals** master MP3 duration (1:1 timeline alignment).
- Both files are **ephemeral** — uploaded per build, lost on page reload.

These constraints are load-bearing — without them this design needs alignment logic and
length validation. They are guaranteed by the user's recording workflow, so we do not
defensively validate them.

## Scope

### In scope

- Optional silent talking-head MP4 upload alongside master MP3 in Step 1.
- Configurable single tag (default `ugc-head`) — sections matching that tag get auto-sliced
  from the talking-head file by absolute timestamp.
- Fallback to existing B-roll matcher when talking-head not uploaded.
- Hide re-roll / swap controls for talking-head sections; show TH badge + slice timestamp
  + preview button.
- Lazy thumbnail extraction at slice start frame, cached in memory.
- Render-worker writes the talking-head file to MEMFS once and reuses across all slices.
- Auto re-match on talking-head upload / clear / tag-mapping change, preserving B-roll locks.
- **Removes** existing IndexedDB persistence of master MP3 — audio also becomes ephemeral
  React state. Pattern parity with talking-head.

### Out of scope

- Multi-tag mapping (more than one tag → one talking-head file).
- Multiple talking-head files (e.g. multi-host VSL).
- Persisting talking-head across reload.
- Length / codec / aspect-ratio validation (user contract guarantees alignment).
- Generalising MEMFS write-once dedupe to all B-roll clips.
- Handling talking-head with audio (user pre-strips before upload).

## Architecture

### Approach

Treat each talking-head section as a **synthetic single-clip MatchedSection** whose clip
references the shared talking-head file plus an absolute seek-into-source position
(`sourceSeekMs = section.startMs`). No new "track" concept, no pre-slicing into separate
files. Renderer adds `-ss <sourceSeekMs>` before `-i` to slice at encode time.

Fits the existing pipeline with one optional field on `MatchedClip` and a single new branch
in the render-worker section loop.

### Data model

`MatchedClip` (in `src/lib/auto-match.ts`) gains:

```ts
sourceSeekMs?: number;  // absolute seek-into-source position, ms
```

Set only on talking-head clips. Render-worker checks its presence to take the slice branch.

`PlaybackPlanClip` (in `src/lib/playback-plan.ts`) gains the same field, propagated through.

`BuildState` gains:

```ts
talkingHeadFile: File | null;
talkingHeadTag: string;            // default "ugc-head"
setTalkingHead(file: File | null): void;
setTalkingHeadTag(tag: string): void;
```

Held in React state only. No IndexedDB. Constant export:

```ts
export const TALKING_HEAD_FILE_ID = "__talking_head__";
```

Used as the synthetic `fileId` so the player and renderer can route resolution to the
talking-head blob/buffer instead of `mediaPool`.

### Auto-match

`matchSections` accepts an optional fourth arg:

```ts
interface TalkingHeadConfig { fileId: string; tag: string }  // tag stored lowercase
matchSections(sections, clipsByBaseName, state?, talkingHead?)
```

Per-section logic:

```
if talkingHead && section.tag.toLowerCase() === talkingHead.tag:
    emit one MatchedClip {
      clipId: "talking-head",
      fileId: talkingHead.fileId,
      speedFactor: 1,
      trimDurationMs: section.durationMs,
      sourceSeekMs: section.startMs * 1000,
      isPlaceholder: false,
    }
else:
    existing B-roll matching path (unchanged)
```

When `talkingHead` is null OR the tag does not match this section, the existing B-roll path
runs untouched. If no B-roll variants exist either, the existing placeholder behaviour is
preserved (black frames + warning).

### Re-match trigger

`talkingHeadFile`, `talkingHeadTag`, or master MP3 change → `preserveLocks(...)` is called
with the new config, producing a new timeline. Locks survive when their tag still matches
the new mapping; locks on a section that swaps in/out of talking-head territory are dropped
and reported via toast.

### Server-side renderer (`src/app/api/render/route.ts`)

Render runs server-side via native `ffmpeg`, not in a Web Worker. The dead
`src/workers/render-worker.ts` file is not part of the active pipeline and is left untouched.

The G1 "write once, reuse" property is automatic server-side: the API already builds a
`clipsByFileId: Map<string, diskPath>` from uploaded `clips` form parts, each written once
to a tmp directory. The talking-head file is uploaded as one more `clips` entry whose
`File.name` equals `TALKING_HEAD_FILE_ID`. No special pre-loop or post-loop bookkeeping
needed — `clipsByFileId.get(TALKING_HEAD_FILE_ID)` returns the same disk path for every
slice, and the tmp dir is wiped in the `finally` block.

Changes required:

- **Frontend `render-trigger.tsx`:** when `talkingHeadFile` is present and any timeline clip
  references `TALKING_HEAD_FILE_ID`, append it to the form data:

  ```ts
  if (talkingHeadFile && usedFileIds.has(TALKING_HEAD_FILE_ID)) {
    fd.append("clips", new File([talkingHeadFile], TALKING_HEAD_FILE_ID));
  }
  ```

  `usedFileIds` already collects fileIds from non-placeholder clips — talking-head clips
  pass `isPlaceholder: false` so `TALKING_HEAD_FILE_ID` is included automatically.

- **Server route encode block:** add a branch for `matched.sourceSeekMs !== undefined`:

  ```ts
  if (matched.sourceSeekMs !== undefined) {
    const inputPath = clipsByFileId.get(matched.fileId);
    if (!inputPath) continue;
    await runFFmpeg([
      "-y",
      "-ss", String(matched.sourceSeekMs / 1000),  // input seek (accurate by default in ffmpeg ≥2.1)
      "-i", inputPath,
      "-t", String(matched.trimDurationMs! / 1000),
      "-vf",
        `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2,` +
        `setpts=PTS-STARTPTS`,                     // reset PTS after seek
      "-an",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode",
      "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-f", "mpegts",
      segPath,
    ]);
  } else if (matched.isPlaceholder) {
    // existing black-segment branch
  } else {
    // existing B-roll branch
  }
  ```

`speedFactor` is always 1 for talking-head clips; `setpts=PTS-STARTPTS` resets PTS after the
seek so the concat step sees a clean MPEG-TS segment with timestamps starting at zero.

### Preview player

`<video>` URL resolution becomes a callback rather than a Map lookup:

```ts
function resolveClipUrl(fileId: string): string | null {
  if (fileId === TALKING_HEAD_FILE_ID) return talkingHeadUrl;
  return mediaPool.getFileURL(fileId);
}
```

`talkingHeadUrl` is a memoised `URL.createObjectURL(talkingHeadFile)`, revoked on file
change.

When playing a clip with `sourceSeekMs !== undefined`:

1. Set `<video>.src` to talking-head URL (no-op if already set).
2. On `loadedmetadata` (or immediately if already loaded): `<video>.currentTime =
   (sourceSeekMs + localOffsetMs) / 1000`.
3. Play. When local offset reaches `clip.endMs - clip.startMs`, advance to next clip.

B-roll path is unchanged.

### Step 1 UI

In `audio-upload.tsx`, below the MP3 dropzone:

- File picker `Talking-head MP4 (optional, silent)` — calls `setTalkingHead(file)`. Shows
  filename, duration, and a Clear button when set.
- Text input `Tag` — controlled by `talkingHeadTag`, default `ugc-head`. Inline informative
  warning if the tag value does not appear in any parsed section.

### Editor section card

Detect talking-head section via `section.clips[0]?.sourceSeekMs !== undefined`.

- Hide re-roll button.
- Hide / disable manual swap picker.
- Show a coloured badge `TH` (suggest `border-purple-500` for visual distinction).
- Show metadata line `0:24.700 → 0:27.360 (2.66s)` from `startMs`/`endMs`.
- Add `Preview slice` button that seeks the preview player to `section.startMs`.

### Thumbnail extraction (lazy)

New file `src/lib/talking-head-thumbnail.ts`:

- Module-level `Map<sourceSeekMs, blobUrl>` cache (singleton per page-load).
- Cache miss → ffmpeg.wasm extracts a single frame:
  `-ss <sec> -i talking.mp4 -frames:v 1 -f image2 thumb.png`.
- Returns blob URL for the thumbnail; subsequent calls hit cache.
- On `talkingHeadFile` change: cache cleared, all blob URLs revoked.

Hook `useTalkingHeadThumbnail(sourceSeekMs)` consumes this from section cards.

### Missing-matches panel

Existing panel adds one informative line when `talkingHeadFile === null` and the configured
tag has ≥1 section in the parsed script: `N sections expect talking-head (not uploaded —
will use B-roll fallback)`. Does not block render.

## Removed: master audio IndexedDB persistence

Pattern parity with talking-head ephemerality:

- Drop `putAudio` / `getAudio` / `clearAudio` calls from `build-state-context.tsx`.
- Remove `putAudio` / `getAudio` / `clearAudio` exports from `media-storage.ts`.
- Drop the audio-related tests in `media-storage.test.ts`.

The `audio` object store currently exists in the IndexedDB schema (`media-storage.ts:56-58`,
also wiped by `resetAll`). Leave the store creation in place so we do not need an IDB
schema migration; just stop reading and writing it. Any orphan rows in users' existing DBs
become inert — `resetAll` still clears them.

Reload now loses both audio and talking-head — expected per user decision.

## Edge cases

| Case | Behaviour |
|---|---|
| Talking-head not uploaded, tag matches sections | Fallback to B-roll matcher; if no variants, existing placeholder warning |
| Tag input value not present in any section | Inline warning beside input; render still works (file unused) |
| User clears talking-head mid-build | Re-match auto-runs; affected sections fall back; toast if locks dropped |
| User changes tag mapping mid-build | Re-match auto-runs |
| Two consecutive talking-head sections | Each gets its own MEMFS exec with `-ss`; no special merge |
| Talking-head shorter than last `ugc-head` end (contract violation) | Out of scope; ffmpeg may produce a short / black-padded segment, treated as user error |

## Testing

### Unit tests

- `auto-match.test.ts`
  - Tag matches → `MatchedClip.sourceSeekMs === section.startMs * 1000`, `speedFactor === 1`,
    `trimDurationMs === durationMs`.
  - `talkingHead === null` → existing B-roll path, no `sourceSeekMs`.
  - Tag mismatch → existing B-roll path, no `sourceSeekMs`.
  - Mixed timeline: subset of sections take TH path, others take B-roll path.
- `playback-plan.test.ts`
  - `sourceSeekMs` propagates from `MatchedClip` to `PlaybackPlanClip`.
- `lock-preserve.test.ts`
  - Talking-head config change re-derives TH sections deterministically.
  - B-roll locks unaffected when only TH config changes.

### Manual smoke

- Render with talking-head + 3+ `ugc-head` sections → verify lip-sync at each section start.
- Clear talking-head mid-build → timeline auto-falls-back; render produces black/B-roll for
  affected sections.
- Re-upload a different talking-head → timeline updates; thumbnail cache invalidates.

## Files touched

| File | Change |
|---|---|
| `src/lib/auto-match.ts` | Add `TALKING_HEAD_FILE_ID`, `TalkingHeadConfig`, `sourceSeekMs`, talking-head branch |
| `src/lib/playback-plan.ts` | Carry `sourceSeekMs` through to `PlaybackPlanClip` |
| `src/lib/lock-preserve.ts` | Plumb talking-head config to `matchSections` |
| `src/lib/media-storage.ts` | Remove `putAudio` / `getAudio` / `clearAudio` + store |
| `src/lib/__tests__/media-storage.test.ts` | Drop audio-related tests |
| `src/lib/talking-head-thumbnail.ts` | NEW — singleton thumbnail cache |
| `src/components/build/build-state-context.tsx` | Talking-head state, remove audio IDB, F1 re-match |
| `src/components/build/audio-upload.tsx` | Talking-head file picker + tag input |
| `src/components/editor/timeline/*` (section card) | TH detection, hide re-roll/swap, badge, preview button |
| `src/components/editor/preview/preview-player.tsx` | Synthetic fileId resolver, seek-into-source playback |
| `src/app/api/render/route.ts` | New `sourceSeekMs` branch with `-ss` before `-i` and `setpts=PTS-STARTPTS` |
| `src/components/build/render-trigger.tsx` | Append talking-head File to `clips` form data when used |
| `src/lib/__tests__/auto-match.test.ts` | Talking-head match tests |
| `src/lib/__tests__/playback-plan.test.ts` | `sourceSeekMs` propagation tests |
| `src/lib/__tests__/lock-preserve.test.ts` | TH config-change tests |
