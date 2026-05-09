# Talking-Head Auto-Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-slice a single uploaded silent talking-head MP4 into sections matching a configurable tag (default `ugc-head`) so the user no longer needs to cut talking-head footage in CapCut.

**Architecture:** Treat each talking-head section as a synthetic single-clip `MatchedSection` whose `MatchedClip` carries `sourceSeekMs = section.startMs * 1000`. Same shared `fileId = "__talking_head__"` across all slices. Server-side ffmpeg adds `-ss <sec>` before `-i` to slice at encode time; preview player seeks the `<video>` element by the same value. Falls back to existing B-roll matcher when the talking-head file is not uploaded. Audio + talking-head are both ephemeral React state — IndexedDB persistence for audio is removed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, vitest, Tailwind CSS 4, server-side native ffmpeg via `/api/render`.

**Spec:** [`docs/superpowers/specs/2026-05-09-talking-head-slice-design.md`](../specs/2026-05-09-talking-head-slice-design.md)

---

## Phase 0 — Remove master-audio IndexedDB persistence

Make audio ephemeral first so the new talking-head state mirrors an established pattern.

### Task 0.1: Drop audio IDB calls from build state

**Files:**
- Modify: `src/components/build/build-state-context.tsx`
- Modify: `src/lib/media-storage.ts`
- Modify: `src/lib/__tests__/media-storage.test.ts`

- [ ] **Step 1: Remove audio API tests**

In `src/lib/__tests__/media-storage.test.ts`, delete:
- The `putAudio`, `getAudio`, `clearAudio` imports.
- The three `it(...)` blocks that exercise `putAudio` / `getAudio` / `clearAudio` / `resetAll → audio cleared`.
- Any helper var (e.g. `AudioRecord` typed const) used only by those tests.

Leave the `audio` object store creation in `media-storage.ts` untouched — no IDB schema migration.

- [ ] **Step 2: Run tests, expect pass**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: PASS (remaining folder/clip tests still green).

- [ ] **Step 3: Remove audio API exports**

In `src/lib/media-storage.ts`, delete the `putAudio`, `getAudio`, `clearAudio` functions and the `AudioRecord` type. Keep the object-store creation in the `upgrade` callback (no migration). Keep `resetAll` clearing the `"audio"` store so legacy rows get wiped if a user runs reset.

- [ ] **Step 4: Strip audio IDB use from build state**

In `src/components/build/build-state-context.tsx`:

Replace the `setAudio` async function (lines ~116–131) with a synchronous setter:

```ts
function setAudio(file: File | null, duration: number | null) {
  setAudioFile(file);
  setAudioDuration(duration);
}
```

Remove the `useEffect` block that calls `getAudio()` (lines ~133–144) entirely.

- [ ] **Step 5: Verify typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, no references to `putAudio`/`getAudio`/`clearAudio` remain.

- [ ] **Step 6: Commit**

```bash
git add src/components/build/build-state-context.tsx src/lib/media-storage.ts src/lib/__tests__/media-storage.test.ts
git commit -m "refactor(build-state): make master audio ephemeral, drop IDB persistence"
```

---

## Phase 1 — Auto-match data model + talking-head branch

Pure-function changes, fully TDD.

### Task 1.1: Add `sourceSeekMs` field and `TALKING_HEAD_FILE_ID` constant

**Files:**
- Modify: `src/lib/auto-match.ts`

- [ ] **Step 1: Add the constant and extend `MatchedClip`**

At the top of `src/lib/auto-match.ts`, after the existing `import` lines, add:

```ts
/** Synthetic fileId used for the singleton talking-head MP4 across all sliced clips. */
export const TALKING_HEAD_FILE_ID = "__talking_head__";
```

In the `MatchedClip` interface, add the new optional field:

```ts
export interface MatchedClip {
  clipId: string;
  fileId: string;
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
  /** Absolute seek-into-source position (ms). Set only on talking-head clips. */
  sourceSeekMs?: number;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — no consumers break, the field is optional.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auto-match.ts
git commit -m "feat(auto-match): add sourceSeekMs field + TALKING_HEAD_FILE_ID constant"
```

### Task 1.2: Talking-head branch in `matchSections`

**Files:**
- Modify: `src/lib/auto-match.ts`
- Modify: `src/lib/__tests__/auto-match.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/__tests__/auto-match.test.ts` (above the closing of the file's last `describe` or at the end as a new `describe` block):

```ts
import { TALKING_HEAD_FILE_ID } from "../auto-match";

describe("matchSections — talking-head branch", () => {
  const thConfig = { fileId: TALKING_HEAD_FILE_ID, tag: "ugc-head" };

  it("emits a single talking-head clip with sourceSeekMs = section.startMs * 1000", () => {
    const sections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 24.7,
        endTime: 27.36,
        tag: "ugc-head",
        scriptText: "hi",
        durationMs: 2660,
      },
    ];
    const result = matchSections(sections, new Map(), undefined, thConfig);
    expect(result).toHaveLength(1);
    expect(result[0]!.clips).toEqual([
      {
        clipId: "talking-head",
        fileId: TALKING_HEAD_FILE_ID,
        speedFactor: 1,
        trimDurationMs: 2660,
        sourceSeekMs: 24700,
        isPlaceholder: false,
      },
    ]);
    expect(result[0]!.warnings).toEqual([]);
  });

  it("matches tag case-insensitively", () => {
    const sections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 0,
        endTime: 1,
        tag: "UGC-Head",
        scriptText: "",
        durationMs: 1000,
      },
    ];
    const result = matchSections(sections, new Map(), undefined, thConfig);
    expect(result[0]!.clips[0]!.sourceSeekMs).toBe(0);
    expect(result[0]!.clips[0]!.fileId).toBe(TALKING_HEAD_FILE_ID);
  });

  it("falls back to B-roll matcher when talkingHead is undefined (existing path)", () => {
    const sections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 0,
        endTime: 1,
        tag: "ugc-head",
        scriptText: "",
        durationMs: 1000,
      },
    ];
    const result = matchSections(sections, new Map(), undefined, undefined);
    // No talking-head, no B-roll candidates → existing placeholder behaviour.
    expect(result[0]!.clips[0]!.isPlaceholder).toBe(true);
    expect(result[0]!.clips[0]!.sourceSeekMs).toBeUndefined();
  });

  it("falls back to B-roll matcher when section tag does not match the configured talking-head tag", () => {
    const clip = makeClip("fs-clipper-freakout-01", 5000);
    const sections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 0,
        endTime: 1,
        tag: "fs-clipper-freakout",
        scriptText: "",
        durationMs: 1000,
      },
    ];
    const result = matchSections(
      sections,
      buildClipsByBaseName([clip]),
      undefined,
      thConfig,
    );
    expect(result[0]!.clips[0]!.fileId).toBe("fs-clipper-freakout-01");
    expect(result[0]!.clips[0]!.sourceSeekMs).toBeUndefined();
  });

  it("supports a mixed timeline: TH and B-roll sections both correct", () => {
    const clip = makeClip("fs-clipper-freakout-01", 5000);
    const sections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 0,
        endTime: 1,
        tag: "fs-clipper-freakout",
        scriptText: "",
        durationMs: 1000,
      },
      {
        lineNumber: 2,
        startTime: 1,
        endTime: 2,
        tag: "ugc-head",
        scriptText: "",
        durationMs: 1000,
      },
    ];
    const result = matchSections(
      sections,
      buildClipsByBaseName([clip]),
      undefined,
      thConfig,
    );
    expect(result[0]!.clips[0]!.fileId).toBe("fs-clipper-freakout-01");
    expect(result[1]!.clips[0]!.fileId).toBe(TALKING_HEAD_FILE_ID);
    expect(result[1]!.clips[0]!.sourceSeekMs).toBe(1000);
  });

  it("emits zero clips for a zero-duration section even when tag matches talking-head", () => {
    const sections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 0,
        endTime: 0,
        tag: "ugc-head",
        scriptText: "",
        durationMs: 0,
      },
    ];
    const result = matchSections(sections, new Map(), undefined, thConfig);
    expect(result[0]!.clips).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `pnpm test src/lib/__tests__/auto-match.test.ts`
Expected: FAIL with type errors on the 4-arg `matchSections` calls (signature only takes 3 args today).

- [ ] **Step 3: Implement the talking-head branch**

In `src/lib/auto-match.ts`, add the `TalkingHeadConfig` type just above `matchSections`:

```ts
export interface TalkingHeadConfig {
  fileId: string;
  /** Tag stored lowercase. Caller must normalise. */
  tag: string;
}
```

Update the `matchSections` signature and prepend the talking-head branch inside the `.map` body:

```ts
export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  state?: MatchState,
  talkingHead?: TalkingHeadConfig | null,
): MatchedSection[] {
  const s = state ?? createMatchState();
  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];
    const startMs = section.startTime * 1000;
    const endMs = section.endTime * 1000;

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, startMs, endMs, durationMs: 0, clips: [], warnings };
    }

    // Talking-head branch: deterministic slice, bypasses B-roll matcher entirely.
    if (talkingHead && section.tag.toLowerCase() === talkingHead.tag) {
      return {
        sectionIndex,
        tag: section.tag,
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{
          clipId: "talking-head",
          fileId: talkingHead.fileId,
          speedFactor: 1,
          trimDurationMs: section.durationMs,
          sourceSeekMs: startMs,
          isPlaceholder: false,
        }],
        warnings,
      };
    }

    // ...existing B-roll matching code unchanged...
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test src/lib/__tests__/auto-match.test.ts`
Expected: PASS — all new TH tests + existing B-roll tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): talking-head branch with deterministic slice"
```

### Task 1.3: Plumb `TalkingHeadConfig` through `preserveLocks`

**Files:**
- Modify: `src/lib/lock-preserve.ts`
- Modify: `src/lib/__tests__/lock-preserve.test.ts` (or create if absent)

- [ ] **Step 1: Check whether `lock-preserve.test.ts` exists**

Run: `ls src/lib/__tests__/lock-preserve.test.ts`
If it does not exist, create it in step 2 with one minimal new test.

- [ ] **Step 2: Write failing test**

Append (or create with) the following in `src/lib/__tests__/lock-preserve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { preserveLocks } from "../lock-preserve";
import { TALKING_HEAD_FILE_ID, type ClipMetadata } from "../auto-match";
import type { ParsedSection } from "../script-parser";

describe("preserveLocks — talking-head config", () => {
  it("derives talking-head clips when the talkingHead config is passed through", () => {
    const oldTimeline = [] as never[];
    const newSections: ParsedSection[] = [
      {
        lineNumber: 1,
        startTime: 5,
        endTime: 6,
        tag: "ugc-head",
        scriptText: "",
        durationMs: 1000,
      },
    ];
    const result = preserveLocks(
      oldTimeline,
      newSections,
      new Map<string, ClipMetadata[]>(),
      { fileId: TALKING_HEAD_FILE_ID, tag: "ugc-head" },
    );
    expect(result.newTimeline[0]!.clips[0]!.sourceSeekMs).toBe(5000);
    expect(result.newTimeline[0]!.clips[0]!.fileId).toBe(TALKING_HEAD_FILE_ID);
  });
});
```

- [ ] **Step 3: Run, verify failure**

Run: `pnpm test src/lib/__tests__/lock-preserve.test.ts`
Expected: FAIL — `preserveLocks` does not accept a 4th arg.

- [ ] **Step 4: Implement the plumb-through**

In `src/lib/lock-preserve.ts`:

1. Import `TalkingHeadConfig`:
   ```ts
   import { matchSections, createMatchState, markUsed, type MatchedSection, type ClipMetadata, type TalkingHeadConfig } from "./auto-match";
   ```
2. Extend `preserveLocks` signature: add `talkingHead?: TalkingHeadConfig | null` as the 4th argument.
3. Pass `talkingHead` through every call site of `matchSections` inside the function body (search for `matchSections(` and add the arg as the 4th parameter, keeping `state`/`undefined` as the 3rd).

- [ ] **Step 5: Verify pass**

Run: `pnpm test src/lib/__tests__/lock-preserve.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lock-preserve.ts src/lib/__tests__/lock-preserve.test.ts
git commit -m "feat(lock-preserve): plumb TalkingHeadConfig through to matchSections"
```

---

## Phase 2 — Build state + Step 1 UI

### Task 2.1: Add talking-head fields to `BuildState`

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Extend the interface and provider**

In `src/components/build/build-state-context.tsx`, after the existing audio fields in the `BuildState` interface, add:

```ts
talkingHeadFile: File | null;
talkingHeadTag: string;
setTalkingHead: (file: File | null) => void;
setTalkingHeadTag: (tag: string) => void;
```

In `BuildStateProvider`, after the `audioDuration` `useState` line, add:

```ts
const [talkingHeadFile, setTalkingHeadFileState] = useState<File | null>(null);
const [talkingHeadTag, setTalkingHeadTagState] = useState<string>("ugc-head");

const setTalkingHead = useCallback((file: File | null) => {
  setTalkingHeadFileState(file);
}, []);
const setTalkingHeadTag = useCallback((tag: string) => {
  // Always store lowercase — match logic compares `section.tag.toLowerCase()` to this value.
  setTalkingHeadTagState(tag.trim().toLowerCase());
}, []);
```

In the `useMemo` returning `value`, add the four new entries to the returned object and add `talkingHeadFile`, `talkingHeadTag` to the dep array.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(build-state): add talkingHeadFile + talkingHeadTag fields"
```

### Task 2.2: Talking-head upload + tag input UI inside the Audio dialog

The existing dialog in `src/components/editor/dialogs/audio-dialog.tsx` is the natural home (Step 1 in the wizard). We append a simple talking-head row + tag input after the existing audio dropzone, behind the same dialog.

**Files:**
- Modify: `src/components/build/audio-upload.tsx`
- Modify: `src/components/editor/dialogs/audio-dialog.tsx`

- [ ] **Step 1: Add a `TalkingHeadUpload` component**

At the end of `src/components/build/audio-upload.tsx`, add a new exported component:

```tsx
import { Music, Video, X } from "lucide-react";

interface TalkingHeadUploadProps {
  file: File | null;
  duration: number | null;
  tag: string;
  tagInScript: boolean;
  onFile: (file: File | null, duration: number | null) => void;
  onTagChange: (tag: string) => void;
}

export function TalkingHeadUpload({
  file,
  duration,
  tag,
  tagInScript,
  onFile,
  onTagChange,
}: TalkingHeadUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".mp4")) {
      alert("Talking-head must be an MP4 file.");
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(f);
    video.onloadedmetadata = () => {
      onFile(f, video.duration);
      URL.revokeObjectURL(video.src);
    };
    onFile(f, null);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Talking-head (optional, silent MP4)</p>
      {file ? (
        <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
          <Video className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.name}</p>
            {duration !== null && <p className="text-xs text-muted-foreground">{formatDuration(duration)}</p>}
          </div>
          <button onClick={() => onFile(null, null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-2 cursor-pointer hover:bg-muted/20"
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <Video className="w-6 h-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Drop MP4 here or click to browse</p>
          <input ref={inputRef} type="file" accept=".mp4" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tag</label>
        <input
          type="text"
          value={tag}
          onChange={(e) => onTagChange(e.target.value)}
          placeholder="ugc-head"
          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        />
        {!tagInScript && tag.length > 0 && (
          <p className="text-xs text-amber-500">
            Tag &quot;{tag}&quot; does not appear in the parsed script.
          </p>
        )}
      </div>
    </div>
  );
}
```

Note: this references the existing module-level `formatDuration` helper. Keep `Music` import — it's still used by `AudioUpload`.

- [ ] **Step 2: Wire the new component into the audio dialog**

In `src/components/editor/dialogs/audio-dialog.tsx`:

Replace the existing imports + body so the talking-head fields plumb through. The `handleFile` for audio stays the same; add a parallel handler for the talking-head file. The dialog now shows two stacked upload rows.

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AudioUpload, TalkingHeadUpload } from "@/components/build/audio-upload";
import { useBuildState } from "@/components/build/build-state-context";

interface AudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AudioDialog({ open, onOpenChange }: AudioDialogProps) {
  const {
    audioFile, audioDuration, setAudio, sections, clearParsed,
    talkingHeadFile, talkingHeadTag, setTalkingHead, setTalkingHeadTag,
  } = useBuildState();

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDuration, setPendingDuration] = useState<number | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const [thFile, setThFile] = useState<File | null>(talkingHeadFile);
  const [thDuration, setThDuration] = useState<number | null>(null);

  useEffect(() => { setThFile(talkingHeadFile); }, [talkingHeadFile]);

  useEffect(() => {
    if (!open) {
      setConfirmReplace(false);
      setPendingFile(null);
      setPendingDuration(null);
    }
  }, [open]);

  function handleAudio(file: File | null, duration: number | null) {
    if (sections && audioFile && file && file !== audioFile) {
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

  function handleTalkingHead(file: File | null, duration: number | null) {
    setThFile(file);
    setThDuration(duration);
    setTalkingHead(file);
  }

  const tagInScript = !!sections && sections.some((s) => s.tag.toLowerCase() === talkingHeadTag);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Audio &amp; Talking-Head</DialogTitle>
            <DialogDescription>
              Upload the master MP3. Optionally upload a silent talking-head MP4 to auto-slice for tagged sections.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <AudioUpload file={audioFile} duration={audioDuration} onFile={handleAudio} />
            <TalkingHeadUpload
              file={thFile}
              duration={thDuration}
              tag={talkingHeadTag}
              tagInScript={tagInScript}
              onFile={handleTalkingHead}
              onTagChange={setTalkingHeadTag}
            />
          </div>
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
              and timeline — you&apos;ll need to re-paste the script.
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

- [ ] **Step 3: Verify the build**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/build/audio-upload.tsx src/components/editor/dialogs/audio-dialog.tsx
git commit -m "feat(audio-dialog): add talking-head MP4 upload + tag input"
```

---

## Phase 3 — Auto re-match on talking-head config change

### Task 3.1: Trigger `preserveLocks` when talking-head config changes

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Add a re-match effect**

`BuildStateProvider` is nested inside `MediaPoolProvider` in `src/app/layout.tsx`, so it can call `useMediaPool()` directly to read the clip list reactively.

At the top of `src/components/build/build-state-context.tsx`, add the imports:

```ts
import { preserveLocks } from "@/lib/lock-preserve";
import { buildClipsByBaseName, TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
import { useMediaPool } from "@/state/media-pool";
```

In `BuildStateProvider`, near the top of the function, add:

```ts
const { videos: mediaPoolClips } = useMediaPool();
```

Then below the existing `useState` block (and before the `useMemo`) add the re-match effect:

```ts
// Re-match deterministically when talking-head config changes. Uses preserveLocks so any
// user-locked B-roll sections survive. Talking-head sections themselves never carry locks
// because re-roll/swap controls are hidden for them (see Phase 7).
useEffect(() => {
  if (!sections || !timeline) return;
  const clipsByBaseName = buildClipsByBaseName(mediaPoolClips);
  const thConfig = talkingHeadFile && talkingHeadTag.length > 0
    ? { fileId: TALKING_HEAD_FILE_ID, tag: talkingHeadTag }
    : null;
  const result = preserveLocks(timeline, sections, clipsByBaseName, thConfig);
  setTimeline(result.newTimeline);
  if (result.droppedCount > 0) {
    console.warn(`[talking-head re-match] ${result.droppedCount} locks dropped`);
  }
  // `timeline` and `mediaPoolClips` are intentionally NOT in the deps — those change for
  // many unrelated reasons. This effect only fires on talking-head config edits.
   
}, [talkingHeadFile, talkingHeadTag]);
```

The eslint-disable comment is intentional: react-hooks/exhaustive-deps would otherwise demand `timeline`/`sections`/`mediaPoolClips` be in the dep array, which would re-fire the effect on every re-roll, re-paste, or library mutation.

- [ ] **Step 2: Verify build**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

Smoke test manually: open dev server (`pnpm dev`), paste a script with `ugc-head` sections, then upload a talking-head file → timeline should auto-update to show the talking-head clip on each `ugc-head` section. Clear the talking-head → timeline reverts to placeholders or B-roll fallback. Change the tag input → timeline re-derives.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(build-state): auto re-match timeline when talking-head config changes"
```

---

## Phase 4 — Server-side render branch

### Task 4.1: Add `sourceSeekMs` branch to `/api/render`

**Files:**
- Modify: `src/app/api/render/route.ts`

- [ ] **Step 1: Insert the talking-head encode branch**

In `src/app/api/render/route.ts`, locate the section-clip encode block (lines ~113–154 in the current file). The current shape is:

```ts
if (matched.isPlaceholder) {
  // black segment
} else {
  // B-roll encode
}
```

Replace it with:

```ts
if (matched.sourceSeekMs !== undefined) {
  const inputPath = clipsByFileId.get(matched.fileId);
  if (!inputPath) continue;
  await runFFmpeg([
    "-y",
    "-ss", String(matched.sourceSeekMs / 1000),  // input seek (accurate by default in ffmpeg ≥ 2.1)
    "-i", inputPath,
    "-t", String((matched.trimDurationMs ?? section.durationMs) / 1000),
    "-vf",
      `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
      `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2,` +
      `setpts=PTS-STARTPTS`,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    segPath,
  ]);
} else if (matched.isPlaceholder) {
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
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/render/route.ts
git commit -m "feat(api/render): add sourceSeekMs branch with -ss before -i"
```

---

## Phase 5 — Frontend render upload

### Task 5.1: Append talking-head MP4 to render formData

**Files:**
- Modify: `src/components/build/render-trigger.tsx`

- [ ] **Step 1: Pull talking-head from build state and upload it**

In `src/components/build/render-trigger.tsx`:

1. Add the import:
   ```ts
   import { TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
   import { useBuildState } from "@/components/build/build-state-context";
   ```
2. In the component body, pull the file:
   ```ts
   const { talkingHeadFile } = useBuildState();
   ```
3. After the existing `for (const fileId of usedFileIds)` loop, insert:
   ```ts
   if (talkingHeadFile && usedFileIds.has(TALKING_HEAD_FILE_ID)) {
     fd.append("clips", new File([talkingHeadFile], TALKING_HEAD_FILE_ID));
   }
   ```

The `usedFileIds` set already contains `TALKING_HEAD_FILE_ID` whenever the timeline has a talking-head clip (it filters non-placeholder clips). The mediaPool lookup for that fileId returns nothing — that's why we need the explicit `talkingHeadFile` append above.

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual smoke render**

Run `pnpm dev`. Build a small VSL with one `ugc-head` section + a real talking-head MP4. Click Render. Check that:
- Network tab shows a `clips` form part named `__talking_head__`.
- The downloaded `vsl-*.mp4` plays the talking-head face during the `ugc-head` window with correct lip-sync.

If lip-sync is off, fallback to D4 (transcode talking-head to all-keyframe upfront) — add a separate task.

- [ ] **Step 4: Commit**

```bash
git add src/components/build/render-trigger.tsx
git commit -m "feat(render-trigger): upload talking-head MP4 with TALKING_HEAD_FILE_ID name"
```

---

## Phase 6 — Preview player

### Task 6.1: Carry `sourceSeekMs` through the playback plan

**Files:**
- Modify: `src/lib/playback-plan.ts`
- Modify: `src/lib/__tests__/playback-plan.test.ts` (or create)

- [ ] **Step 1: Write failing test**

Append to (or create) `src/lib/__tests__/playback-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSectionPlaybackPlan, buildFullTimelinePlaybackPlan } from "../playback-plan";
import { TALKING_HEAD_FILE_ID, type MatchedSection } from "../auto-match";

describe("playback-plan — sourceSeekMs propagation", () => {
  const timeline: MatchedSection[] = [{
    sectionIndex: 0,
    tag: "ugc-head",
    startMs: 5000,
    endMs: 6000,
    durationMs: 1000,
    clips: [{
      clipId: "talking-head",
      fileId: TALKING_HEAD_FILE_ID,
      speedFactor: 1,
      trimDurationMs: 1000,
      sourceSeekMs: 5000,
      isPlaceholder: false,
    }],
    warnings: [],
  }];

  it("buildSectionPlaybackPlan carries sourceSeekMs through", () => {
    const urls = new Map([[TALKING_HEAD_FILE_ID, "blob:fake"]]);
    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", urls);
    expect(plan.clips[0]!.sourceSeekMs).toBe(5000);
  });

  it("buildFullTimelinePlaybackPlan carries sourceSeekMs through", () => {
    const urls = new Map([[TALKING_HEAD_FILE_ID, "blob:fake"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "blob:audio", urls);
    expect(plan.clips[0]!.sourceSeekMs).toBe(5000);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: FAIL — `sourceSeekMs` not present on emitted clips.

- [ ] **Step 3: Add the field + propagate it**

In `src/lib/playback-plan.ts`:

1. Extend `PlaybackPlanClip`:
   ```ts
   export interface PlaybackPlanClip {
     srcUrl: string;
     startMs: number;
     endMs: number;
     speedFactor: number;
     fileId: string;
     /** Absolute seek-into-source position (ms). Set only for talking-head clips. */
     sourceSeekMs?: number;
   }
   ```
2. In `buildSectionPlaybackPlan`, the clips push line becomes:
   ```ts
   clips.push({
     srcUrl: url,
     startMs,
     endMs,
     speedFactor: c.speedFactor,
     fileId: c.fileId,
     sourceSeekMs: c.sourceSeekMs,
   });
   ```
3. Same change in `buildFullTimelinePlaybackPlan`.

- [ ] **Step 4: Verify pass**

Run: `pnpm test src/lib/__tests__/playback-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playback-plan.ts src/lib/__tests__/playback-plan.test.ts
git commit -m "feat(playback-plan): carry sourceSeekMs from MatchedClip to PlaybackPlanClip"
```

### Task 6.2: Resolve talking-head URL + seek `<video>` to source position

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Memoise a talking-head blob URL**

In `preview-player.tsx`, alongside the existing `audioUrl` state, add:

```ts
const { audioFile, talkingHeadFile, /* ...rest unchanged */ } = useBuildState();

const [talkingHeadUrl, setTalkingHeadUrl] = useState<string | null>(null);
useEffect(() => {
  if (!talkingHeadFile) { setTalkingHeadUrl(null); return; }
  const url = URL.createObjectURL(talkingHeadFile);
  setTalkingHeadUrl(url);
  return () => URL.revokeObjectURL(url);
}, [talkingHeadFile]);
```

- [ ] **Step 2: Inject the synthetic URL into the URL map used by playback-plan**

Find the `useEffect` that populates `clipUrlsRef.current` from `mediaPool.getFileURL(...)`. Right after that loop, add:

```ts
import { TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
// ...
if (talkingHeadUrl) {
  clipUrlsRef.current.set(TALKING_HEAD_FILE_ID, talkingHeadUrl);
} else {
  clipUrlsRef.current.delete(TALKING_HEAD_FILE_ID);
}
```

Also bump the `useEffect` dep array to include `talkingHeadUrl` so the map updates when the file changes.

- [ ] **Step 3: Seek the `<video>` element when a TH clip becomes active**

Locate the play-loop logic that swaps `<video>.src` per clip. Where the player sets `videoElement.currentTime = ...` for advancing in B-roll, add a branch for `clip.sourceSeekMs !== undefined` that targets:

```ts
const local = audioPlayheadMs - clip.startMs; // ms within the clip slot
const targetSec = (clip.sourceSeekMs! + local) / 1000;
if (Math.abs(videoElement.currentTime - targetSec) > 0.05) {
  videoElement.currentTime = targetSec;
}
```

For B-roll the existing logic stays — only the talking-head branch uses `sourceSeekMs`.

- [ ] **Step 4: Verify typecheck + smoke**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

Manual smoke: `pnpm dev` → click a `ugc-head` section in timeline → preview player shows the correct talking-head frame, plays from `section.startMs` for `section.durationMs`, and lip-syncs with master audio.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "feat(preview-player): seek talking-head video to absolute sourceSeekMs"
```

---

## Phase 7 — Editor section UI

### Task 7.1: Distinguish talking-head sections in `track-clips.tsx`

**Files:**
- Modify: `src/components/editor/timeline/track-clips.tsx`

- [ ] **Step 1: Add a TH-aware branch**

In `src/components/editor/timeline/track-clips.tsx`:

1. Add a derived boolean per section: `const isTalkingHead = section.clips.some((c) => c.sourceSeekMs !== undefined);`
2. Extend the `cn(...)` class on the section block to add a purple border when `isTalkingHead` is true:
   ```ts
   isTalkingHead && "border-purple-500/60 bg-purple-500/5",
   ```
3. Inside the inner `.map`, add a TH branch before the existing `isPlaceholder` and B-roll branches:
   ```tsx
   c.sourceSeekMs !== undefined ? (
     <div
       key={j}
       className="relative flex-1 min-w-0 bg-purple-500/15 flex items-center justify-center text-purple-200 text-[10px] font-semibold"
       title={`Talking-head ${formatMs(c.sourceSeekMs)} → ${formatMs(c.sourceSeekMs + (c.trimDurationMs ?? 0))}`}
     >
       TH
     </div>
   ) : c.isPlaceholder ? (
     // existing placeholder branch
   ) : (
     // existing ClipThumb branch
   )
   ```
4. Add `import { formatMs } from "@/lib/format-time";` at the top if not already present.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/timeline/track-clips.tsx
git commit -m "feat(timeline): purple TH badge for talking-head sections"
```

### Task 7.2: Hide re-roll/swap controls for TH sections in section-editor

**Files:**
- Modify: `src/components/build/section-editor/variant-grid.tsx` (or whichever component owns the section inspector that hosts re-roll/swap)

- [ ] **Step 1: Locate the section inspector**

Run: `grep -rn "re-roll\|reroll\|Re-roll\|swap" src/components/ | head`
Identify the component that shows re-roll + swap for the currently selected section. This is likely a sibling of `variant-grid.tsx` / `chain-strip.tsx` inside `section-editor/`.

- [ ] **Step 2: Branch on talking-head**

In that component, near the top:

```ts
const isTalkingHead = section.clips.some((c) => c.sourceSeekMs !== undefined);
```

Wrap the re-roll button + the variant grid + the chain strip in `{!isTalkingHead && (...)}`. In the `isTalkingHead` case, render a small read-only summary instead:

```tsx
{isTalkingHead ? (
  <div className="rounded-md border border-purple-500/40 bg-purple-500/5 p-3 space-y-1">
    <div className="text-xs font-semibold text-purple-300">Talking-head slice</div>
    <div className="text-xs text-muted-foreground tabular-nums">
      {formatMs(section.startMs)} → {formatMs(section.endMs)} ({((section.durationMs) / 1000).toFixed(2)}s)
    </div>
    <Button size="sm" variant="outline" onClick={() => playerSeekRef.current?.(section.startMs)}>
      Preview slice
    </Button>
  </div>
) : (
  // existing variant grid + chain strip + re-roll
)}
```

(Adjust component-local names like `playerSeekRef` to match what the file already uses.)

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

Manual smoke: select a `ugc-head` section in the editor → no re-roll/swap controls visible, only the TH summary + Preview button.

- [ ] **Step 4: Commit**

```bash
git add src/components/build/section-editor/
git commit -m "feat(section-editor): hide re-roll/swap for talking-head sections, show TH summary"
```

---

## Phase 8 — Lazy talking-head thumbnails

This is a polish step. Skip if Phase 7 fills enough of the UX gap.

### Task 8.1: Singleton thumbnail cache

**Files:**
- Create: `src/lib/talking-head-thumbnail.ts`

- [ ] **Step 1: Write the cache module**

```ts
// src/lib/talking-head-thumbnail.ts
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
const cache = new Map<string, string>(); // key = `${fileFingerprint}:${sourceSeekMs}`

let currentFingerprint: string | null = null;

function fingerprintFile(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function ensureFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;
  const baseURL = "/ffmpeg";
  const instance = new FFmpeg();
  loadPromise = (async () => {
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await instance.load({ coreURL, wasmURL });
    ffmpeg = instance;
    return instance;
  })();
  return loadPromise;
}

/** Clears every cached blob URL when the talking-head file is replaced or removed. */
export function resetTalkingHeadThumbnails(file: File | null): void {
  const fp = file ? fingerprintFile(file) : null;
  if (fp === currentFingerprint) return;
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  currentFingerprint = fp;
}

/**
 * Returns a blob URL for a single video frame at `sourceSeekMs` of the given talking-head
 * file, decoding via ffmpeg.wasm on demand. Cached by `(file fingerprint, sourceSeekMs)`.
 */
export async function getTalkingHeadThumbnail(file: File, sourceSeekMs: number): Promise<string> {
  resetTalkingHeadThumbnails(file);
  const key = `${currentFingerprint}:${sourceSeekMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const ff = await ensureFFmpeg();
  const inputName = "th-input.mp4";
  const outputName = `th-${sourceSeekMs}.png`;
  const buf = new Uint8Array(await file.arrayBuffer());
  await ff.writeFile(inputName, buf);
  await ff.exec([
    "-y",
    "-ss", String(sourceSeekMs / 1000),
    "-i", inputName,
    "-frames:v", "1",
    "-f", "image2",
    outputName,
  ]);
  const png = (await ff.readFile(outputName)) as Uint8Array;
  try { await ff.deleteFile(inputName); } catch {}
  try { await ff.deleteFile(outputName); } catch {}
  const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
  cache.set(key, url);
  return url;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — module is independent.

- [ ] **Step 3: Wire from `track-clips.tsx`**

Replace the static `TH` badge from Task 7.1 with an `<img>` whose `src` resolves via the cache:

```tsx
function TalkingHeadThumb({ file, sourceSeekMs }: { file: File; sourceSeekMs: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/talking-head-thumbnail").then(({ getTalkingHeadThumbnail }) =>
      getTalkingHeadThumbnail(file, sourceSeekMs).then((u) => { if (!cancelled) setUrl(u); }),
    );
    return () => { cancelled = true; };
  }, [file, sourceSeekMs]);
  return url
    ? <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
    : <div className="absolute inset-0 flex items-center justify-center text-purple-200 text-[10px] font-semibold">TH</div>;
}
```

In the TH branch, render `<TalkingHeadThumb file={talkingHeadFile} sourceSeekMs={c.sourceSeekMs} />` when `talkingHeadFile` exists; fall back to the plain TH badge otherwise. (Pull `talkingHeadFile` from `useBuildState`.)

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

Manual smoke: select a TH section → real frame thumbnail appears instead of just a badge.

- [ ] **Step 5: Commit**

```bash
git add src/lib/talking-head-thumbnail.ts src/components/editor/timeline/track-clips.tsx
git commit -m "feat(timeline): lazy talking-head thumbnail extraction with ffmpeg.wasm cache"
```

---

## Final verification

- [ ] **Run full test suite**

Run: `pnpm test`
Expected: PASS, no failures, no skips beyond pre-existing ones.

- [ ] **Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **End-to-end manual render**

Build a real VSL with: master MP3 + talking-head MP4 + script with several `ugc-head` sections + at least one B-roll section. Click Render. Verify the downloaded MP4 has the correct face during each `ugc-head` window with audible lip-sync, and B-roll plays everywhere else.

- [ ] **Spec coverage check**

Compare against `docs/superpowers/specs/2026-05-09-talking-head-slice-design.md` — every requirement has an executed task. Mark spec status: `Implemented`.
