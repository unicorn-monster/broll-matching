# Broll Click-to-Preview + Smooth Resume

**Date:** 2026-04-27
**Status:** Approved, pending implementation

## Goal

When the user clicks a broll thumbnail in the library panel, the center preview player switches to that broll (auto-play once, stop at end frame, original audio). Clicking anywhere else exits back to the timeline preview, with the timeline `<video>` and `<audio>` resuming smoothly from where they were paused — no reset to clip start.

## Motivation

Two pain points combined:

1. **Inspecting brolls is slow.** Today the only way to view a broll is to find it on the timeline (or upload a fresh test). Users want to click a thumbnail and immediately see the clip, like CapCut.
2. **Timeline preview "resets to clip start" on resume.** When the user pauses mid-clip and presses play, the video momentarily flashes back to the clip's first frame before snapping to the correct offset. Caused by `video.src = clip.srcUrl` running on every plan rebuild because clip identity is checked by reference equality, even when the URL is unchanged. Setting `src` triggers a full HTMLVideoElement reload regardless.

These are bundled into one design because the broll-preview feature reuses the timeline `<video>` would worsen problem 2 (extra src thrashing on every mode switch). Solving them together with a dual-video architecture + stable identity check is cleaner than two separate fixes.

## Design

### Architecture

Three units, each with one clear purpose:

1. **Stable clip identity** — utility in `src/lib/playback-plan.ts`:
   ```ts
   export function clipIdentityKey(clip: PlaybackPlanClip): string {
     return `${clip.indexeddbKey}:${clip.startMs}`;
   }
   ```
   Replaces reference-equality comparison in `ensureClipLoaded`.

2. **Guarded src setter** — local helper in `preview-player.tsx`:
   ```ts
   function setVideoSrcIfChanged(video: HTMLVideoElement, url: string) {
     if (video.src === url || video.currentSrc === url) return;
     video.src = url;
   }
   ```
   Prevents redundant reloads when `clip.srcUrl` is the same string we already set.

3. **Broll preview state + dual `<video>` element**:
   - `BuildState` gets `previewClipKey: string | null` + `setPreviewClipKey`.
   - `PreviewPlayer` renders two `<video>` elements: `videoTimeline` and `videoPreview`. Toggle `display` based on `previewClipKey === null`.
   - `ClipGrid` thumbnail tiles call `setPreviewClipKey(clip.indexeddbKey)` on click.
   - `EditorShell` registers a document-level `mousedown` capture: when `previewClipKey != null` and the target is not inside `[data-broll-thumbnail]`, set null.

### Data flow

**Timeline mode (default):** `videoTimeline` visible, `videoPreview` hidden. Audio drives playback. `ensureClipLoaded` uses `clipIdentityKey` and `setVideoSrcIfChanged` — never reloads when the underlying clip and URL are unchanged. Resume from pause is now smooth: the bail check passes, video.play() continues from current `currentTime`.

**Enter preview mode** (click thumbnail):
1. `setPreviewClipKey(indexeddbKey)`.
2. `useEffect` on `previewClipKey` in PreviewPlayer:
   - If timeline is playing, pause both `audio` and `videoTimeline` (preserve `currentTime`).
   - Look up blob URL from `clipUrlsRef`; if missing (broll not on timeline), `await getClip(key)` + `URL.createObjectURL`, store in `clipUrlsRef`.
   - `videoPreview.src = url`, `videoPreview.muted = false`, `videoPreview.currentTime = 0`, `videoPreview.play()`.
   - Toggle visibility.

**Inside preview mode:**
- `videoPreview.onEnded` → `pause()` (stops at last frame).
- Click another thumbnail → useEffect re-runs with new key → swap src, currentTime = 0, play.
- Click same thumbnail again → state unchanged, no-op (broll stays at last frame). User must click outside first to "reset".

**Exit preview mode** (click outside thumbnail):
1. Global mousedown capture in EditorShell: target lacks `[data-broll-thumbnail]` → `setPreviewClipKey(null)`.
2. PreviewPlayer useEffect:
   - `videoPreview.pause()`.
   - Toggle visibility (preview hidden, timeline visible).
   - Do **not** touch `videoTimeline` or `audio` — their state is preserved exactly as it was on enter. Per Q4: timeline stays paused; user clicks play themselves.

### Files changed

| File | Change |
|------|--------|
| `src/lib/playback-plan.ts` | Add `clipIdentityKey` export. |
| `src/components/build/build-state-context.tsx` | Add `previewClipKey` + `setPreviewClipKey` to context. |
| `src/components/editor/preview/preview-player.tsx` | Stable identity check, guarded src setter, second `<video>`, preview-mode useEffect, hide play button when previewing. |
| `src/components/broll/clip-grid.tsx` | Bind onClick to thumbnail (not full tile — preserve edit/delete buttons), add `data-broll-thumbnail` attribute. |
| `src/components/editor/editor-shell.tsx` | Document-level mousedown capture to exit preview when clicking outside. |

No new files. No changes to library-panel, timeline-panel, clip-storage, auto-match.

### Edge cases

- **Click thumbnail mid-pre-fetch.** `clipUrlsRef` may not have the key yet on first paint. Fetch on demand inside the useEffect. Show no flash — `videoPreview` stays hidden until src is set + first frame ready.
- **Broll not on timeline.** Same fetch-on-demand path. `clipUrlsRef` is populated and reused if the user previews multiple times.
- **Timeline playing when entering preview.** Pause both audio and videoTimeline; record nothing extra — their `currentTime` survives. Q4: do not auto-resume on exit.
- **Click thumbnail edit/delete buttons.** Pencil/trash buttons inside the tile must call `e.stopPropagation()` on their onClick to prevent the thumbnail's onClick (which sets preview key) from firing. Their `closest('[data-broll-thumbnail]')` still resolves to the tile, so the global exit-capture treats the click as "inside thumbnail" and does not exit preview — matching user expectation that editing a tile name doesn't exit preview mode.
- **Reverted state mid-preview** (e.g., timeline gets cleared via dialog while previewing). PreviewPlayer adds a `useEffect` that calls `setPreviewClipKey(null)` whenever `audioFile === null` or `timeline === null` — keeps state consistent with the "Set audio in the toolbar to begin" empty state.

### Testing

- Click each broll thumbnail in library: expect preview swap < 100ms (no flash).
- Pause timeline mid-clip, press play: expect resume from current frame, no reset to clip start.
- Click thumbnail while timeline plays: expect timeline pause, broll auto-play once, stop at end frame.
- Click outside (toolbar, timeline panel, empty preview area): expect timeline visible again, paused at the same time.
- Click another thumbnail while previewing: expect new broll, currentTime = 0, auto-play.
- Click same thumbnail twice: second click is no-op (broll stays at end frame).

### Out of scope

- Hover-to-preview on thumbnail (CapCut has it; not requested).
- Visual indicator on active thumbnail (Q6 = D, none).
- Scrubber/timeline UI inside the broll preview (not requested).
- Loop playback for broll preview.

## Approval

Approved by user (verbal) across architecture, data flow, file list. User requested implementation start before review of testing/edge-case sections.
