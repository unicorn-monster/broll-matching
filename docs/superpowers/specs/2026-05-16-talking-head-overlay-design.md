# Talking-Head Overlay (Cutout PIP) — Design

Date: 2026-05-16
Status: Approved (brainstorm), pending implementation plan.

## Problem

Current pipeline supports multi-talking-head layers that play **full-frame** during sections
tagged with the layer's name. The user wants a new capability: a cutout / picture-in-picture
talking-head that **overlays** the bottom-right corner of whatever else is playing (b-roll or
full talking-head), creating the familiar reaction-video look.

The source is regular UGC mp4 (no green screen), so the background must be removed via AI
matting. Matting runs entirely in the browser (Chrome/Edge) using MediaPipe Selfie
Segmenter + WebCodecs VP9 alpha encoder.

This also collapses the existing N-layer add-talking-head UI to a fixed 2-slot model — one
slot per layer kind (`full`, `overlay`).

## Constraint contract from the user

- Source mp4 for overlay layer is **time-aligned with the master audio** — overlay slices
  are seeked by `section.startMs`, same as existing full talking-head.
- Source mp4 has a **visible single person** (selfie framing). MediaPipe selfie model is
  selected accordingly; group-shot or distant-subject sources are out of scope.
- Browser is **Chromium-based desktop** (Chrome/Edge ≥ 94). Safari, Firefox, and mobile
  Chromium variants are hard-blocked at the upload step (mobile Chrome VP9 alpha encode is
  documented as buggy).
- Per existing TH contract: source mp4 has its audio stripped before upload (the master
  mp3 is the only audio track).

These constraints are load-bearing — without them this design needs alignment validation
and multi-codec encode paths.

## Scope

### In scope

- Replace the single "Add talking-head" toolbar button with **2 fixed pills**:
  `talking-head-full` and `talking-head-overlay`. Each pill is empty (orange) or filled
  (green); the overlay pill shows matting progress while processing.
- Source mp4 upload per slot (independent files). Re-upload prompts a Replace confirm.
- Browser-side matting worker for overlay layer: MediaPipe Selfie Segmenter →
  WebCodecs `VideoEncoder({ codec: 'vp09.00.10.08', alpha: 'keep' })` → WebM mux → IDB.
- Hard-coded overlay layout: bottom-right, 30% width, 24px padding, fixed aspect.
- Script-parser change: tag field allows up to 2 comma+space–separated tags
  (`mower, talking-head-overlay`). Validator enforces ≤1 base tag + ≤1 overlay tag.
- Auto-match change: emits `overlayClip?: MatchedClip` per section in addition to the
  base `clips` chain.
- Render-route change: new ffmpeg filtergraph branch for sections with `overlayClip` —
  base encoded normally, then overlay scaled and composited via `overlay` filter.
- Per-shot delete: select a shot on the timeline + press Delete → adds section key to
  `disabledOverlayShots: Set<string>`. Render & preview skip overlay for that section.
  Inspector shows a "Restore" button per disabled shot.
- Editor preview composites overlay live (hidden `<video>` element per matted file).
- Length warning: source mp4 > 5 minutes → confirm dialog before matting starts.
- Matting modal with progress bar + Abort button. Progress also shown on the pill and in
  the inspector with rough ETA.
- Browser-gate: non-Chromium / mobile Chromium → overlay pill disabled with tooltip.
- Hard rename of full-layer default tag from `talking-head` to `talking-head-full`.
  Existing scripts using `talking-head` get a parser warning suggesting the rename.

### Out of scope (v1)

- Configurable overlay corner, size, padding, or per-section transforms.
- Multiple overlay layers (only one `talking-head-overlay` allowed).
- Multi-base chaining in one section (e.g. `mower, hook` → chained b-roll).
- Same-source dual layer (1 upload feeding both full + overlay).
- Resume-from-checkpoint matting after tab close. (Source mp4 persisted; matting restarts
  from frame 0 on retry.)
- Quality-tuning UI (alpha smooth slider, alternate model selection).
- Server-side matting fallback for Safari / Firefox / mobile.
- Re-process if the matting model is upgraded later.

## Mental model

A `talking-head-overlay` shot is a **time slice of a person cutout that floats on top of
whatever the base layer is rendering** at that moment.

```
script line: 00:30 - 00:45 || "Đây là máy cắt cỏ" || mower, talking-head-overlay

base layer (z=2):   b-roll clip from `mower` folder, scaled to 1080×1920
overlay (z=3):      slice of matted overlay webm at sourceSeekMs=30000ms,
                    scaled to 30% width (324px), positioned bottom-right with 24px pad
final frame:        b-roll fills 1080×1920, person cutout sits in bottom-right corner
```

Render Z-order (bottom → top): audio • base (b-roll or talking-head-full) •
talking-head-overlay • text-overlay • section labels.

## Architecture

### Data layer

`TalkingHeadLayer` gains three optional fields:

```ts
export type TalkingHeadKind = 'full' | 'overlay';

export interface TalkingHeadLayer {
  id: string;
  tag: string;                          // 'talking-head-full' | 'talking-head-overlay'
  fileId: string;                       // original mp4 file-id
  label?: string;
  // --- NEW ---
  kind: TalkingHeadKind;
  mattedFileId?: string;                // overlay only — set when matting completes
  mattingStatus?: 'processing' | 'ready' | 'failed';  // overlay only
  mattingProgress?: { framesDone: number; totalFrames: number };  // overlay only
}
```

Store invariant (enforced in helpers + tested): **at most one layer per kind**. The N-layer
array shape is preserved so existing tests stay green; the UI is what enforces the 2-slot
constraint.

IDB bumps to **v3**: a new objectStore `matted-files` keyed by `mattedFileId`. The original
`files` objectStore is unchanged. Cleanup of `matted-files` happens on overlay layer remove
and on overlay layer re-upload.

A new piece of build state in `BuildState`:

```ts
disabledOverlayShots: Set<string>;   // key = `${startMs}-${endMs}`
```

Stable section key over `sectionIndex` because the index shifts on any script edit. Re-parse
prunes set entries whose key no longer matches any parsed section.

### Script parser change

[src/lib/script-parser.ts](src/lib/script-parser.ts): the trailing `(.*)` tag group is split
on `,` and trimmed. Output type changes from `tag: string` to `tags: string[]`.

Validator additions:

- If `tags.length > 2` → error `Line N: max 2 tags per section (got K)`.
- If 2 tags but both classify as "base" (i.e., neither is `talking-head-overlay`) → error
  `Line N: only one base tag allowed (got 'mower', 'hook')`.
- If `talking-head-overlay` appears more than once → error.
- If a tag equals `talking-head` → warning suggesting `talking-head-full`.

All downstream consumers (`auto-match`, store helpers, UI badges) must be updated to read
`tags` instead of `tag`. Backward-compat shim is **not** added — this is a hard rename.

### Matting worker — `src/workers/matting-worker.ts`

Web Worker (`type: 'module'`). Inputs/outputs over `postMessage`:

```ts
// in
{ type: 'start', sourceBlob: Blob, mattedFileId: string }
{ type: 'abort' }

// out
{ type: 'progress', framesDone: number, totalFrames: number }
{ type: 'done', mattedBlob: Blob }   // WebM with VP9 alpha
{ type: 'failed', message: string }
```

Pipeline per frame:

1. Demux mp4 into encoded video chunks. Use [`mp4box.js`](https://github.com/gpac/mp4box.js)
   (~50 KB gzipped, no deps).
2. `VideoDecoder` decodes chunks → `VideoFrame` (I420 or NV12 typically).
3. Convert frame to RGBA via OffscreenCanvas (`drawImage` + `getImageData`).
4. `ImageSegmenter` (MediaPipe Selfie Segmenter, lazy-loaded ~7 MB on first matting) →
   `categoryMask` (Uint8 same-resolution mask).
5. Build I420A `VideoFrame`: Y/U/V planes from the source frame, A plane = mask.
6. `VideoEncoder({ codec: 'vp09.00.10.08', alpha: 'keep' })` → `EncodedVideoChunk`.
7. Mux via [`webm-muxer`](https://github.com/Vanilagy/webm-muxer) into a WebM Blob.

Progress events fire every 30 source frames (~1 update/sec at 30fps). Abort terminates the
worker, releases the decoder/encoder, and discards any in-flight blob.

### UI changes

**Toolbar pills** — [src/components/editor/toolbar/](src/components/editor/toolbar/):

Replace the single `Add talking-head` button with two fixed slots:

```
[🎵 Audio]  [📄 Script]  [📹 talking-head-full]  [📹 talking-head-overlay]
```

Each slot has 3 visual states:

| State    | Color          | Click action                                  |
|----------|----------------|-----------------------------------------------|
| empty    | orange outline | open upload dialog                            |
| filled   | green fill     | open inspector (re-upload / remove)           |
| processing (overlay only) | yellow + spinner + `XX%` | open matting progress modal |

Overlay slot is `disabled` with tooltip "Yêu cầu Chrome/Edge desktop" when the browser
fails feature-detection (no `VideoEncoder` or mobile UA).

**Upload dialog** — [src/components/editor/dialogs/add-talking-head-dialog.tsx](src/components/editor/dialogs/add-talking-head-dialog.tsx):

Stripped down — no tag input (tag is fixed by kind), no label input (label defaults to
filename). The dialog is opened with `kind` already decided by which pill was clicked.

After a file is selected:

- Full layer → create layer immediately, slot pill turns green.
- Overlay layer → probe duration. If > 5 min, confirm dialog. Then create layer with
  `mattingStatus='processing'`, spawn worker, open matting modal.

**Matting modal** — new component `MattingProgressModal`:

```
Đang tách nền talking-head-overlay
[████████░░░░░░░░░░░░░] 2,430 / 5,400 frames (45%)
~3 phút còn lại
[Huỷ]
```

Closing the modal does not abort; matting continues in the background. Abort button calls
`worker.terminate()` and rolls back layer state.

**Inspector** — [src/components/editor/inspector/talking-head-section-inspector.tsx](src/components/editor/inspector/talking-head-section-inspector.tsx):

For overlay layer, shows: filename, duration, matting status, "Re-upload" / "Remove"
buttons. While processing, shows the same progress bar + elapsed/ETA. After failure, shows
"Retry matting" button (re-runs worker on the source still in IDB).

**Timeline shot delete** — [src/components/editor/timeline/](src/components/editor/timeline/):

Overlay shots render as a thin row above the base row, styled with a corner-PIP icon. Click
selects → Delete key adds the shot key to `disabledOverlayShots`. Disabled shots render
dimmed with a strike-through; clicking selects again and a "Restore" button appears in the
inspector.

### Auto-match update

[src/lib/auto-match.ts](src/lib/auto-match.ts) iterates `section.tags`:

- Classify each tag: `'talking-head-overlay'` → overlay; anything else → base.
- Build base `clips` chain from base tag (unchanged logic — TH layer match wins, fallback
  to b-roll folder).
- If overlay tag present and overlay layer `mattingStatus === 'ready'` and section key not
  in `disabledOverlayShots` → emit `overlayClip`:

```ts
overlayClip: {
  clipId: 'talking-head-overlay',
  fileId: overlayLayer.mattedFileId!,
  speedFactor: 1,
  trimDurationMs: section.durationMs,
  sourceSeekMs: section.startMs,
  isPlaceholder: false,
  isOverlay: true,
}
```

- If overlay tag present but layer not ready → push a section warning `Overlay layer not
  ready — section X rendered without overlay`. No overlayClip emitted.

`MatchedClip` type gains `isOverlay?: boolean`. `MatchedSection` gains `overlayClip?:
MatchedClip`.

### Render pipeline

[src/app/api/render/route.ts](src/app/api/render/route.ts) changes:

1. Accept multipart field `matted-clips` — files whose `.name` is the `mattedFileId`. Write
   each to disk under `workDir`, populate a `mattedByFileId: Map<string, string>`.
2. Per section, if `section.overlayClip` is set:
   - Encode the base segment as before to a temporary `seg-base-N.mp4` (NOT MPEG-TS — we
     need a re-encode step downstream).
   - Run a second ffmpeg pass merging base + overlay:
     ```
     -i seg-base-N.mp4
     -ss <sourceSeekMs/1000> -i <matted.webm>
     -filter_complex
       "[1:v]scale=iw*0.30:-2,setpts=PTS-STARTPTS[fg];
        [0:v][fg]overlay=W-overlay_w-24:H-overlay_h-24:shortest=1[v]"
     -map [v] -t <durationMs/1000>
     -c:v libx264 -preset ultrafast -tune fastdecode -pix_fmt yuv420p -r 30
     -an -f mpegts seg-N.ts
     ```
3. Refactor: extract the per-section encode arg-building into a pure module
   `src/lib/render-segments.ts` (functions: `buildBaseSegmentArgs`, `buildOverlayMergeArgs`,
   `buildBlackGapArgs`). The route consumes the pure builders + spawns ffmpeg. This makes
   the ffmpeg layer unit-testable.
4. Constants module-level inside `render-segments.ts`:
   ```ts
   export const OVERLAY_WIDTH_RATIO = 0.30;
   export const OVERLAY_PADDING_PX = 24;
   export const OVERLAY_ANCHOR = 'bottom-right'; // currently only value used
   ```

### Preview (editor canvas)

The current preview composites base clips frame-by-frame using hidden `<video>` elements
keyed by `fileId`. Overlay layer adds one more hidden `<video>` element keyed by
`mattedFileId`. Per render frame:

1. Draw base clip (existing logic).
2. If active section has `overlayClip` not in `disabledOverlayShots`:
   - Seek the matted `<video>` to `sourceSeekMs + localT` if drifted.
   - Compute overlay rect from constants.
   - `canvas.drawImage(mattedVideoEl, rect.x, rect.y, rect.w, rect.h)`. Browser preserves
     the alpha because the `<video>` element renders VP9 alpha as transparent.

Defensive: if non-Chromium somehow loads a project with an overlay (e.g. project imported),
the matted webm won't render alpha. Detect via feature probe at preview init; if missing,
draw a translucent grey box in the overlay rect with `OVERLAY DISABLED` text.

## Test plan (TDD)

All tests live next to their modules under `__tests__/`.

### Pure-logic tests (vitest)

`src/lib/script-parser.test.ts` (extended):
- single tag still parses
- two tags comma+space → `tags.length === 2`
- comma without space and weird whitespace → tolerated
- three tags → error
- two base tags → error
- duplicate overlay tag → error
- legacy `talking-head` → warning text mentions `talking-head-full`

`src/lib/talking-head/__tests__/talking-head-store.test.ts` (extended):
- add full layer when none exists → ok; add second full layer → store rejects
- add overlay layer → starts `processing`; set status `ready` mutates correctly
- remove overlay layer → both source `fileId` and `mattedFileId` cleared from caller
- per-shot delete / restore round-trip
- re-parse with shifted timestamps prunes stale `disabledOverlayShots` entries

`src/lib/auto-match.test.ts` (extended):
- section `[mower, talking-head-overlay]` with ready overlay → returns base chain +
  `overlayClip` with `sourceSeekMs === section.startMs`
- same section but overlay `mattingStatus = 'processing'` → no overlayClip, warning emitted
- same section but its key is in `disabledOverlayShots` → no overlayClip, no warning
- section `[talking-head-full, talking-head-overlay]` → base = full TH slice, overlay clip
  also emitted

`src/lib/render-segments.test.ts` (new):
- `buildBaseSegmentArgs` produces the same args as the current inline implementation
  (snapshot test against existing render output for one fixture)
- `buildOverlayMergeArgs` produces a filtergraph with `scale=iw*0.30:-2`, `overlay=
  W-overlay_w-24:H-overlay_h-24`, `shortest=1`
- changing `OVERLAY_WIDTH_RATIO` flows into the args

### Worker / integration tests

- Matting worker tested manually via a fixture mp4 in a Playwright spec
  (`tests/matting-smoke.spec.ts`). Asserts: ≥1 progress event fired, final blob is
  non-empty, blob plays in `<video>` with non-opaque pixel in the corner.
- Render route integration test fixture: small (5s) source mp4 + 5s matted webm + 1
  overlay section → MP4 output exists and has expected dimensions. Pixel-level alpha
  correctness is not asserted (visual review).

## Implementation risks

Honest confidence assessment. Mitigations listed where applicable.

| Component | Confidence | Risk | Mitigation |
|-----------|------------|------|------------|
| 2-pill UI + green state | 99% | trivial | — |
| Script-parser multi-tag | 99% | edge case in whitespace handling | thorough test cases |
| ffmpeg overlay filtergraph | 95% | filter syntax typo | render-segments unit tests |
| IDB v3 migration | 95% | upgrade path bug | manual test of v2 → v3 |
| Per-shot delete + stable key | 90% | section key drift on script edits | re-parse pruning test |
| Auto-match update | 95% | tag classification edge cases | covered by tests |
| MediaPipe in Web Worker | 80% | `tasks-vision` worker WebGL context may need OffscreenCanvas + WebGL2 explicitly | spike during impl, fall back to main-thread MediaPipe if blocked |
| mp4box.js demux + VideoDecoder | 75% | keyframe / B-frame ordering edge cases | use a known-good demo as scaffold |
| WebCodecs VP9 alpha encode | 70% | I420A frame construction (alpha plane alignment) is fiddly | reference Chrome alpha-transparency blog post during impl |
| webm-muxer with alpha track | 70% | lib has alpha support but undocumented for selfie case | verify with the same fixture used in tests |
| Real-world matting quality | 60% | hair / hands / glasses artifacts always present | ship as-is with README guidance |

User accepted the risk (no spike phase). If implementation hits >1 of the 70%-band
landmines, the agreed pivot is to revisit and potentially move matting to a server-side
Python service instead.

## Open questions

None. All design decisions resolved during brainstorm + grill rounds.

## Migration / breaking changes

- Existing scripts using tag `talking-head` (without `-full`) will parse but emit a
  warning. Sections will still match if the full layer's tag is renamed by the user — the
  UI rename is not automatic; user must re-tag both the layer and the script.
- IDB schema bump v2 → v3 with one new objectStore. Existing layers / files migrate
  unchanged. No data loss.
- Existing N-layer projects in browser state will retain all layers in the data model, but
  the UI will only surface the first `kind='full'` and first `kind='overlay'`. Legacy
  layers without a `kind` field default to `kind='full'` on read. There is no UI to access
  legacy extra layers; users wanting them must edit IDB or downgrade. Acceptable —
  multi-layer was developer-only.
