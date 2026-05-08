# Broll Click-to-Preview + Smooth Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click any broll thumbnail in the library panel to preview it in the center player (auto-play once, stop at end frame, original audio). Click outside to return to timeline preview. Bundle a fix to the timeline preview so resume from pause no longer flashes back to the clip start.

**Architecture:** Three units delivered in order: (1) `clipIdentityKey` utility + stable identity check in `ensureClipLoaded` so the timeline `<video>` no longer reloads on each plan rebuild; (2) `setVideoSrcIfChanged` guard so even legitimate src assignments to the same URL are noops; (3) `previewClipKey` state in BuildState driving a second `<video>` element in PreviewPlayer, click-binding on ClipGrid thumbnails, and a document-level mousedown capture in EditorShell to exit. The two `<video>` elements coexist permanently and toggle via `display`, so mode switching never reloads the timeline video.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest. HTMLVideoElement APIs. IndexedDB blob storage via existing `clip-storage` lib.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/playback-plan.ts` | Add `clipIdentityKey` export. |
| `src/lib/__tests__/playback-plan.test.ts` | Add tests for `clipIdentityKey`. |
| `src/components/build/build-state-context.tsx` | Add `previewClipKey` + `setPreviewClipKey` to BuildState. |
| `src/components/editor/preview/preview-player.tsx` | Stable identity, guarded src setter, second `<video>`, preview-mode useEffect. |
| `src/components/broll/clip-grid.tsx` | Thumbnail onClick → `setPreviewClipKey`, `data-broll-thumbnail` attribute, edit/delete `e.stopPropagation()`. |
| `src/components/editor/editor-shell.tsx` | Document mousedown capture to exit preview when clicking outside thumbnail. |

No new files. No changes to library-panel, timeline-panel, clip-storage, auto-match.

---

### Task 1: Stable clip identity utility

**Files:**
- Modify: `src/lib/playback-plan.ts`
- Test: `src/lib/__tests__/playback-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/playback-plan.test.ts`:

```typescript
import { clipIdentityKey } from "../playback-plan";

describe("clipIdentityKey", () => {
  it("returns indexeddbKey:startMs", () => {
    const clip = { srcUrl: "blob:abc", startMs: 1500, endMs: 3000, speedFactor: 1, indexeddbKey: "k7" } as any;
    expect(clipIdentityKey(clip)).toBe("k7:1500");
  });

  it("differentiates same blob at different startMs (same clip used twice)", () => {
    const a = { srcUrl: "blob:abc", startMs: 0, endMs: 1000, speedFactor: 1, indexeddbKey: "k1" } as any;
    const b = { srcUrl: "blob:abc", startMs: 4000, endMs: 5000, speedFactor: 1, indexeddbKey: "k1" } as any;
    expect(clipIdentityKey(a)).not.toBe(clipIdentityKey(b));
  });

  it("matches across plan rebuilds when key+startMs are equal", () => {
    const a = { srcUrl: "blob:1", startMs: 2000, endMs: 4000, speedFactor: 1, indexeddbKey: "k3" } as any;
    const a2 = { srcUrl: "blob:2", startMs: 2000, endMs: 4000, speedFactor: 1.2, indexeddbKey: "k3" } as any;
    expect(clipIdentityKey(a)).toBe(clipIdentityKey(a2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts -t "clipIdentityKey"`
Expected: FAIL — `clipIdentityKey` not exported.

- [ ] **Step 3: Add `indexeddbKey` to `PlaybackPlanClip` and implement `clipIdentityKey`**

Edit `src/lib/playback-plan.ts`. Update the interface and both builders to carry `indexeddbKey`, and add the helper:

```typescript
export interface PlaybackPlanClip {
  srcUrl: string;
  startMs: number;
  endMs: number;
  speedFactor: number;
  indexeddbKey: string;
}

export function clipIdentityKey(clip: PlaybackPlanClip): string {
  return `${clip.indexeddbKey}:${clip.startMs}`;
}
```

In `buildSectionPlaybackPlan`, change the push to:

```typescript
clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor, indexeddbKey: c.indexeddbKey });
```

In `buildFullTimelinePlaybackPlan`, same change:

```typescript
clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor, indexeddbKey: c.indexeddbKey });
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: PASS — all existing tests still green, new ones green.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/playback-plan.ts src/lib/__tests__/playback-plan.test.ts
git commit -m "feat(playback-plan): add clipIdentityKey helper and indexeddbKey on PlaybackPlanClip"
```

---

### Task 2: Use stable identity in PreviewPlayer

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

This task switches `currentClipRef` from a reference comparison of `PlaybackPlanClip` objects to a string-based comparison via `clipIdentityKey`. No tests — `preview-player.tsx` has no unit tests in the project; behavior is verified manually + by typecheck. (Project pattern: only pure libs in `src/lib/__tests__` are tested.)

- [ ] **Step 1: Replace `currentClipRef` declaration with key-based ref**

In `src/components/editor/preview/preview-player.tsx`, change:

```typescript
const currentClipRef = useRef<PlaybackPlanClip | null>(null);
```

to:

```typescript
const currentClipKeyRef = useRef<string | null>(null);
```

Remove the `PlaybackPlanClip` import if it becomes unused (keep if still referenced elsewhere in the file).

- [ ] **Step 2: Update `ensureClipLoaded` import and usage**

At the top of the file, ensure the import line includes `clipIdentityKey`:

```typescript
import {
  buildFullTimelinePlaybackPlan,
  findClipAtMs,
  findSectionAtMs,
  clipIdentityKey,
  type PlaybackPlanClip,
} from "@/lib/playback-plan";
```

In `ensureClipLoaded`, replace the existing identity check + assignment block:

```typescript
const ensureClipLoaded = useCallback(
  (audioMs: number) => {
    const video = videoRef.current;
    if (!video || !plan) return;
    const clip = findClipAtMs(plan.clips, audioMs);
    const nextKey = clip ? clipIdentityKey(clip) : null;
    if (currentClipKeyRef.current === nextKey) return;
    currentClipKeyRef.current = nextKey;
    if (!clip) {
      video.removeAttribute("src");
      video.load();
      return;
    }
    setVideoSrcIfChanged(video, clip.srcUrl);
    video.playbackRate = clip.speedFactor;
    const offsetSec = ((audioMs - clip.startMs) * clip.speedFactor) / 1000;
    const seekWhenReady = () => {
      try {
        video.currentTime = Math.max(0, offsetSec);
      } catch {
        // ignore — currentTime can throw if metadata not yet ready
      }
      if (audioRef.current && !audioRef.current.paused) void video.play();
    };
    if (video.readyState >= 1) seekWhenReady();
    else video.addEventListener("loadedmetadata", seekWhenReady, { once: true });
  },
  [plan],
);
```

`setVideoSrcIfChanged` is added in Task 3 — define a temporary inline placeholder for now to keep typecheck green:

At the top of the file (above the component), add:

```typescript
function setVideoSrcIfChanged(video: HTMLVideoElement, url: string) {
  // Replaced with full implementation in Task 3.
  if (video.src === url) return;
  video.src = url;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings).

- [ ] **Step 5: Manual smoke test**

- Run: `pnpm dev`.
- Open an editor with a project that has audio + parsed timeline.
- Press play; let it play through 2-3 clip transitions; pause mid-clip; press play.
- Expected: resume continues from current frame; no flash to clip start.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "fix(preview): use stable clip identity key to prevent timeline reload on plan rebuild"
```

---

### Task 3: Harden `setVideoSrcIfChanged` with `currentSrc` fallback

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

Browsers report `video.src` as the raw assigned string but `video.currentSrc` as the resolved (absolute) URL. After mode switches, an inadvertent reload could be triggered if we compare against the wrong field. This task hardens the guard.

- [ ] **Step 1: Replace the placeholder with the hardened version**

Replace the function defined at the top of `preview-player.tsx` in Task 2:

```typescript
function setVideoSrcIfChanged(video: HTMLVideoElement, url: string) {
  if (video.src === url || video.currentSrc === url) return;
  video.src = url;
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Same as Task 2 Step 5. Behavior should be unchanged — this is defensive hardening.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "fix(preview): guard video.src assignment against same URL via currentSrc check"
```

---

### Task 4: Add `previewClipKey` to BuildState

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Add field to `BuildState` interface**

In `src/components/build/build-state-context.tsx`, locate the `BuildState` interface. Add these two lines after `setExportDialogOpen`:

```typescript
  previewClipKey: string | null;
  setPreviewClipKey: (key: string | null) => void;
```

- [ ] **Step 2: Add state and include in context value**

Inside `BuildStateProvider`, after the `useState` for `exportDialogOpen`, add:

```typescript
const [previewClipKey, setPreviewClipKey] = useState<string | null>(null);
```

In the `useMemo` returning the context value, add the two fields to the returned object (between `setExportDialogOpen` and `inspectorMode`):

```typescript
      previewClipKey,
      setPreviewClipKey,
```

In the `useMemo` dependency array, add `previewClipKey` (after `exportDialogOpen`).

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(build-state): add previewClipKey state for broll click-preview"
```

---

### Task 5: Render second `<video>` and preview-mode useEffect in PreviewPlayer

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

This is the core of the feature. PreviewPlayer gets a second `<video>` element and a useEffect that drives it when `previewClipKey` is non-null.

- [ ] **Step 1: Pull `previewClipKey` and `setPreviewClipKey` from context**

In the `useBuildState()` destructure at the top of `PreviewPlayer`, add:

```typescript
    previewClipKey,
    setPreviewClipKey,
```

- [ ] **Step 2: Add `previewVideoRef`**

After the existing `videoRef` and `audioRef` declarations:

```typescript
const previewVideoRef = useRef<HTMLVideoElement | null>(null);
```

- [ ] **Step 3: Add the preview-mode useEffect**

After the existing useEffects (after the section-seek useEffect at line ~165), add this new useEffect:

```typescript
// Drive the preview <video> when previewClipKey is set: pause timeline,
// load broll, auto-play once, stop at end frame. Exit (key set to null)
// pauses the preview <video> but does NOT touch timeline state.
useEffect(() => {
  const previewVideo = previewVideoRef.current;
  if (!previewVideo) return;

  if (previewClipKey === null) {
    previewVideo.pause();
    return;
  }

  const audio = audioRef.current;
  const timelineVideo = videoRef.current;
  if (audio && !audio.paused) audio.pause();
  if (timelineVideo && !timelineVideo.paused) timelineVideo.pause();

  let cancelled = false;
  (async () => {
    let url = clipUrlsRef.current.get(previewClipKey);
    if (!url) {
      const buf = await getClip(previewClipKey);
      if (cancelled || !buf) return;
      url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
      clipUrlsRef.current.set(previewClipKey, url);
    }
    if (cancelled) return;
    if (previewVideo.src !== url && previewVideo.currentSrc !== url) {
      previewVideo.src = url;
    }
    previewVideo.muted = false;
    previewVideo.playbackRate = 1;
    previewVideo.currentTime = 0;
    void previewVideo.play();
  })();

  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [previewClipKey]);
```

- [ ] **Step 4: Stop playback on broll end**

The `<video>` element's native `onEnded` event auto-pauses it; we just need to make sure we don't loop. By default `<video>` does not loop, so this is already correct — verify in Step 8 manual test.

- [ ] **Step 5: Clear preview when timeline/audio is cleared**

After the preview-mode useEffect, add:

```typescript
useEffect(() => {
  if (!audioFile || !timeline) {
    if (previewClipKey !== null) setPreviewClipKey(null);
  }
}, [audioFile, timeline, previewClipKey, setPreviewClipKey]);
```

- [ ] **Step 6: Render the second `<video>` and toggle visibility**

Replace the existing `<div>` containing the single `<video>` with two `<video>` elements. Find the JSX block:

```jsx
<div
  className="bg-black rounded overflow-hidden flex items-center justify-center"
  style={{ aspectRatio: "4 / 5", height: "calc(100% - 48px)", maxWidth: "100%" }}
>
  <video
    ref={videoRef}
    playsInline
    muted
    className="w-full h-full object-cover"
  />
</div>
```

Replace with:

```jsx
<div
  className="bg-black rounded overflow-hidden flex items-center justify-center relative"
  style={{ aspectRatio: "4 / 5", height: "calc(100% - 48px)", maxWidth: "100%" }}
>
  <video
    ref={videoRef}
    playsInline
    muted
    className="w-full h-full object-cover"
    style={{ display: previewClipKey === null ? "block" : "none" }}
  />
  <video
    ref={previewVideoRef}
    playsInline
    className="w-full h-full object-cover absolute inset-0"
    style={{ display: previewClipKey === null ? "none" : "block" }}
  />
</div>
```

The preview `<video>` is **not muted** (per spec: original broll audio plays).

- [ ] **Step 7: Hide play/pause button when previewing**

Find the play/pause button block:

```jsx
<button
  type="button"
  onClick={togglePlay}
  className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
  aria-label={playing ? "Pause" : "Play"}
>
  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
</button>
```

Wrap it in a conditional render:

```jsx
{previewClipKey === null && (
  <button
    type="button"
    onClick={togglePlay}
    className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
    aria-label={playing ? "Pause" : "Play"}
  >
    {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
  </button>
)}
```

- [ ] **Step 8: Manual smoke test**

- Run: `pnpm dev`.
- Open editor with a parsed timeline.
- Programmatically test the broll preview path: open browser devtools console and run `document.querySelector('video')` to confirm two video elements exist.
- Manually invoke `setPreviewClipKey` is not yet possible from UI (Task 6 wires it). Use React DevTools to set `previewClipKey` to a known IndexedDB key, OR proceed to Task 6 first.
- Acceptable to verify only by typecheck for now; full UI test happens after Task 7.

- [ ] **Step 9: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "feat(preview): add second video element and preview-mode useEffect for broll click-preview"
```

---

### Task 6: Wire up ClipGrid thumbnails

**Files:**
- Modify: `src/components/broll/clip-grid.tsx`

- [ ] **Step 1: Import `useBuildState`**

At the top of `src/components/broll/clip-grid.tsx`, add:

```typescript
import { useBuildState } from "@/components/build/build-state-context";
```

- [ ] **Step 2: Pull `setPreviewClipKey` inside `ClipGrid`**

Inside `ClipGrid`, just after the `useState` calls:

```typescript
const { setPreviewClipKey } = useBuildState();
```

- [ ] **Step 3: Bind onClick on the thumbnail tile and add data attribute**

Find the tile JSX (line ~142):

```jsx
<div key={clip.id} className="group relative border border-border rounded-lg overflow-hidden bg-muted/20">
```

Replace with:

```jsx
<div
  key={clip.id}
  data-broll-thumbnail
  onClick={() => setPreviewClipKey(clip.indexeddbKey)}
  className="group relative border border-border rounded-lg overflow-hidden bg-muted/20 cursor-pointer"
>
```

- [ ] **Step 4: Stop propagation on edit/delete buttons**

Find the rename input + buttons block. Update the rename ✓ button:

```jsx
<button onClick={(e) => { e.stopPropagation(); handleRename(clip); }} className="text-xs text-green-600">✓</button>
```

The pencil edit-trigger:

```jsx
<button
  onClick={(e) => { e.stopPropagation(); setEditingId(clip.id); setEditName(clip.brollName); }}
  className="text-white hover:text-yellow-300"
>
```

The trash delete-trigger:

```jsx
<button onClick={(e) => { e.stopPropagation(); handleDelete(clip); }} className="text-white hover:text-red-400">
```

The rename Input element should also stop propagation on click so typing/clicking doesn't trigger preview swap. Find the existing rename `<Input>`:

```jsx
<Input
  value={editName}
  onChange={(e) => setEditName(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter") handleRename(clip);
    if (e.key === "Escape") setEditingId(null);
  }}
  autoFocus
  className="h-6 text-xs"
/>
```

Add `onClick={(e) => e.stopPropagation()}`:

```jsx
<Input
  value={editName}
  onChange={(e) => setEditName(e.target.value)}
  onClick={(e) => e.stopPropagation()}
  onKeyDown={(e) => {
    if (e.key === "Enter") handleRename(clip);
    if (e.key === "Escape") setEditingId(null);
  }}
  autoFocus
  className="h-6 text-xs"
/>
```

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

- Run: `pnpm dev`.
- Open editor with a parsed timeline AND brolls in library panel.
- Click a thumbnail.
- Expected: center preview switches to that broll, plays once with sound, stops at last frame. Timeline audio pauses.
- Click another thumbnail: new broll plays from start.
- Click pencil edit on a thumbnail: rename mode opens, preview does NOT swap.
- Click outside thumbnail (e.g., timeline panel): NOT YET — Task 7 wires the exit. For now, the preview stays on the last clicked broll.

- [ ] **Step 7: Commit**

```bash
git add src/components/broll/clip-grid.tsx
git commit -m "feat(library): bind thumbnail onClick to setPreviewClipKey for click-to-preview"
```

---

### Task 7: Document mousedown capture in EditorShell to exit preview

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Add useEffect for mousedown capture**

In `src/components/editor/editor-shell.tsx`, ensure these imports are at the top:

```typescript
import { useEffect } from "react";
```

(May already be implicit via existing imports; check and add if missing.)

Inside the `EditorShell` component, after the existing `useBuildState()` destructure, pull preview state:

```typescript
const { previewClipKey, setPreviewClipKey } = useBuildState();
```

Then add the useEffect (place it before the return):

```typescript
useEffect(() => {
  if (previewClipKey === null) return;
  function onMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-broll-thumbnail]")) return;
    setPreviewClipKey(null);
  }
  document.addEventListener("mousedown", onMouseDown, true);
  return () => document.removeEventListener("mousedown", onMouseDown, true);
}, [previewClipKey, setPreviewClipKey]);
```

The `true` third arg = capture phase, so it fires before any descendant `mousedown` handlers.

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Full manual smoke test (acceptance)**

Run: `pnpm dev`. Open editor with parsed timeline + library brolls. Verify all the following pass:

1. **Click thumbnail → preview broll**: center preview switches to that broll, plays once with sound, stops at last frame. Timeline audio pauses.
2. **Click another thumbnail mid-preview**: new broll plays from start. Sound switches.
3. **Click outside (timeline panel, toolbar, empty space, or center preview area)**: timeline `<video>` becomes visible again at the same currentTime it was paused at. Audio paused.
4. **Click play button on timeline after exit**: timeline resumes from paused position with NO flash to clip start. (This is the "smooth resume" win from Tasks 1-3.)
5. **Pause timeline mid-clip, resume**: same — no flash to clip start.
6. **Click pencil edit on thumbnail**: rename mode opens, preview state unchanged.
7. **Click trash delete on thumbnail**: confirm dialog appears, preview state unchanged.
8. **Click same thumbnail twice in a row**: first click previews; second click is no-op (broll stays at last frame, does not restart).
9. **Open script dialog or audio dialog while previewing**: dialog click triggers exit, then dialog opens normally.
10. **Clear timeline (re-parse with empty script, etc.)**: previewClipKey resets to null automatically.

If any step fails, stop and debug before committing.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/editor-shell.tsx
git commit -m "feat(editor-shell): document mousedown capture to exit broll preview on outside click"
```

---

### Task 8: Verify and final cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run all checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 2: Inspect git log**

Run: `git log --oneline -10`
Expected: 7 task commits + the design doc commit, in order.

- [ ] **Step 3: Inspect diff vs main**

Run: `git diff main...HEAD --stat`
Expected: only the 6 files in the file structure table modified, plus the 1 new spec doc.

- [ ] **Step 4: No additional commit needed.** The work is complete.

---

## Self-review checklist (already performed)

**Spec coverage:**
- ✅ Q1 (replace mode + exit on outside click) → Tasks 5, 7
- ✅ Q2 (auto-play once, stop at end) → Task 5 Step 3 (no loop attribute, no `onEnded` replay)
- ✅ Q3 (original audio, pause timeline) → Task 5 Step 3 (`muted = false`, pause audio + timeline video)
- ✅ Q4 (no auto-resume on exit) → Task 5 Step 3 (cleanup branch only pauses preview, never touches timeline)
- ✅ Q5 (click thumbnail = switch, click anywhere else = exit) → Tasks 6, 7
- ✅ Q6 (no indicator) → No UI added beyond cursor-pointer
- ✅ Fix 1 (stable identity) → Tasks 1, 2
- ✅ Fix 2 (guarded src setter) → Task 3
- ✅ Fix 3 (dual-video) → Task 5

**Type consistency:** `previewClipKey` is `string | null` in BuildState (Task 4), ClipGrid passes `clip.indexeddbKey` (Task 6 — string), preview useEffect reads it as `string | null` (Task 5), document handler resets to `null` (Task 7). ✓

**Placeholder scan:** none.
