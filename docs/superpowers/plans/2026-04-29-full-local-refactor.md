# Full-local Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor app từ "upload-then-process" sang "instant-import" CapCut-style: dùng `showDirectoryPicker` + `HTMLVideoElement` để load folder B-roll trong <1s, bỏ Supabase + IndexedDB + FFmpeg-on-import. Chrome-only localhost dev tool.

**Architecture:** Single folder picker → File[] in-memory pool → auto-match consume `ClipMetadata[]` (logic không đổi) → render worker đọc bytes từ File khi export, thêm scale+pad filter cho output size do user chọn.

**Tech Stack:** Next.js 16, React 19, TypeScript, FFmpeg.wasm, Vitest, File System Access API (`showDirectoryPicker`), HTMLVideoElement.

---

## File Structure

**New files (Phase 1, 3):**
- `src/lib/folder-import.ts` — `pickFolder()` + recursive walk + extension filter
- `src/lib/video-metadata.ts` — `extractVideoMetadata(file)` qua HTMLVideoElement
- `src/lib/__tests__/folder-import.test.ts`
- `src/lib/__tests__/video-metadata.test.ts`
- `src/state/media-pool.tsx` — React Context giữ `videos`, `audios`, `fileMap`, helpers
- `src/components/folder-picker.tsx` — Landing button + progress
- `src/components/render/output-size-select.tsx` — Dropdown chọn W×H

**Modified files (Phase 2, 4, 5, 6):**
- `src/lib/auto-match.ts` — rename `indexeddbKey` → `fileId`
- `src/components/editor/overlay/overlay-drag-source.ts`, `overlay-drag-context.tsx`, `overlay-tracks.tsx`, `overlay-clip-block.tsx`, `overlay-inspector.tsx` — rename field
- `src/components/editor/library/library-panel.tsx` — rename field, đọc URL từ media-pool
- `src/components/editor/preview/preview-player.tsx` — `getClip` → `mediaPool.getFileURL`
- `src/components/editor/timeline/track-clips.tsx` — `getThumbnail` → video element thumbnail
- `src/components/build/script-paste.tsx` — bỏ fetch API, đọc từ media-pool
- `src/components/build/section-editor/{chain-strip,variant-grid,preview-pane}.tsx` — rename + getClip→mediaPool
- `src/components/broll/clip-grid.tsx` — đọc từ media-pool, dùng video element làm thumbnail
- `src/components/build/render-trigger.tsx` — đọc bytes từ fileMap, gửi outputWidth/Height
- `src/workers/render-worker.ts` — thêm scale+pad filter
- `src/lib/__tests__/auto-match.test.ts`, `lock-preserve.test.ts`, `clip-filter.test.ts`, `playback-plan.test.ts` — update field name
- `src/app/page.tsx` — landing folder picker thay vì redirect dashboard
- `src/app/layout.tsx` — wrap MediaPoolProvider
- `package.json` — bỏ db scripts + drizzle deps
- `.env` — bỏ POSTGRES_URL

**Deleted files (Phase 7):**
- `src/lib/db.ts`, `src/lib/schema.ts`, `src/lib/clip-storage.ts`
- `drizzle.config.ts`, `drizzle/` (toàn bộ folder)
- `src/app/api/products/` (toàn bộ)
- `src/app/api/diagnostics/`
- `src/app/dashboard/` (toàn bộ)
- `src/components/broll/clip-upload.tsx`
- `scripts/check-db.mjs`, `scripts/delete-clips.mjs`, `scripts/setup.ts`
- `src/lib/env.ts` (sau khi xác nhận không có env nào còn dùng)

---

## Phase 1 — Foundation modules

Build new pure modules in isolation, test-first. No integration yet.

### Task 1.1: video-metadata.ts

**Files:**
- Create: `src/lib/video-metadata.ts`
- Test: `src/lib/__tests__/video-metadata.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/__tests__/video-metadata.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractVideoMetadata } from "../video-metadata";

describe("extractVideoMetadata", () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => "blob:fake");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("resolves with duration, width, height when video loads", async () => {
    const fakeFile = new File(["fake"], "clip.mp4", { type: "video/mp4" });

    // Stub HTMLVideoElement: fire loadedmetadata immediately on src set
    const original = global.HTMLVideoElement.prototype;
    Object.defineProperty(global.HTMLVideoElement.prototype, "src", {
      configurable: true,
      set(this: HTMLVideoElement) {
        Object.defineProperty(this, "duration", { value: 4.5, configurable: true });
        Object.defineProperty(this, "videoWidth", { value: 1920, configurable: true });
        Object.defineProperty(this, "videoHeight", { value: 1080, configurable: true });
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
      },
    });

    const meta = await extractVideoMetadata(fakeFile);
    expect(meta).toEqual({ durationMs: 4500, width: 1920, height: 1080 });
  });

  it("rejects when video fails to load", async () => {
    const fakeFile = new File(["bad"], "bad.mp4", { type: "video/mp4" });
    Object.defineProperty(global.HTMLVideoElement.prototype, "src", {
      configurable: true,
      set(this: HTMLVideoElement) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      },
    });

    await expect(extractVideoMetadata(fakeFile)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `pnpm vitest run src/lib/__tests__/video-metadata.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement module**

```typescript
// src/lib/video-metadata.ts
export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
}

export function extractVideoMetadata(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeEventListener("loadedmetadata", onLoad);
      video.removeEventListener("error", onError);
    };

    const onLoad = () => {
      const meta = {
        durationMs: Math.round(video.duration * 1000),
        width: video.videoWidth,
        height: video.videoHeight,
      };
      cleanup();
      resolve(meta);
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load metadata for ${file.name}`));
    };

    video.addEventListener("loadedmetadata", onLoad);
    video.addEventListener("error", onError);
    video.src = url;
  });
}
```

- [ ] **Step 4: Run test to verify PASS**

Run: `pnpm vitest run src/lib/__tests__/video-metadata.test.ts`
Expected: PASS, both tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/video-metadata.ts src/lib/__tests__/video-metadata.test.ts
git commit -m "feat(lib): extractVideoMetadata via HTMLVideoElement"
```

---

### Task 1.2: folder-import.ts

**Files:**
- Create: `src/lib/folder-import.ts`
- Test: `src/lib/__tests__/folder-import.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/__tests__/folder-import.test.ts
import { describe, it, expect } from "vitest";
import { categorizeFiles, walkDirectoryHandle } from "../folder-import";

function makeFile(name: string): File {
  return new File(["x"], name, { type: "" });
}

describe("categorizeFiles", () => {
  it("splits files by extension into video/audio/other", () => {
    const files = [
      makeFile("a.mp4"),
      makeFile("b.MOV"),
      makeFile("c.webm"),
      makeFile("song.mp3"),
      makeFile("voice.WAV"),
      makeFile("track.m4a"),
      makeFile("note.txt"),
    ];
    const out = categorizeFiles(files);
    expect(out.videos.map((f) => f.name)).toEqual(["a.mp4", "b.MOV", "c.webm"]);
    expect(out.audios.map((f) => f.name)).toEqual(["song.mp3", "voice.WAV", "track.m4a"]);
  });
});

describe("walkDirectoryHandle", () => {
  it("recursively yields all File entries", async () => {
    const childFile = { kind: "file", name: "deep.mp4", getFile: async () => makeFile("deep.mp4") };
    const subDir = {
      kind: "directory",
      name: "sub",
      async *values() { yield childFile; },
    };
    const rootFile = { kind: "file", name: "root.mp3", getFile: async () => makeFile("root.mp3") };
    const root = {
      kind: "directory",
      name: "root",
      async *values() { yield rootFile; yield subDir; },
    };

    const collected: File[] = [];
    for await (const f of walkDirectoryHandle(root as never)) {
      collected.push(f);
    }
    expect(collected.map((f) => f.name).sort()).toEqual(["deep.mp4", "root.mp3"]);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `pnpm vitest run src/lib/__tests__/folder-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement module**

```typescript
// src/lib/folder-import.ts
const VIDEO_EXTS = [".mp4", ".mov", ".webm"];
const AUDIO_EXTS = [".mp3", ".wav", ".m4a"];

export interface CategorizedFiles {
  videos: File[];
  audios: File[];
}

function hasExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export function categorizeFiles(files: File[]): CategorizedFiles {
  const videos: File[] = [];
  const audios: File[] = [];
  for (const f of files) {
    if (hasExt(f.name, VIDEO_EXTS)) videos.push(f);
    else if (hasExt(f.name, AUDIO_EXTS)) audios.push(f);
  }
  return { videos, audios };
}

export async function* walkDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): AsyncGenerator<File, void, unknown> {
  for await (const entry of (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      yield await fileHandle.getFile();
    } else if (entry.kind === "directory") {
      yield* walkDirectoryHandle(entry as FileSystemDirectoryHandle);
    }
  }
}

export async function pickFolder(): Promise<CategorizedFiles> {
  if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
    throw new Error("showDirectoryPicker not supported (Chrome/Edge required)");
  }
  // @ts-expect-error showDirectoryPicker is missing from lib.dom on some TS versions
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
  const all: File[] = [];
  for await (const file of walkDirectoryHandle(handle)) {
    all.push(file);
  }
  return categorizeFiles(all);
}
```

- [ ] **Step 4: Run test to verify PASS**

Run: `pnpm vitest run src/lib/__tests__/folder-import.test.ts`
Expected: PASS, both tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/folder-import.ts src/lib/__tests__/folder-import.test.ts
git commit -m "feat(lib): folder-import with categorizeFiles + walkDirectoryHandle"
```

---

### Task 1.3: output-size-select component

**Files:**
- Create: `src/components/render/output-size-select.tsx`

- [ ] **Step 1: Implement component**

```tsx
// src/components/render/output-size-select.tsx
"use client";

import { useState } from "react";

export interface OutputSize {
  width: number;
  height: number;
}

const PRESETS: { label: string; size: OutputSize }[] = [
  { label: "1080×1350 (4:5)", size: { width: 1080, height: 1350 } },
  { label: "1080×1920 (9:16)", size: { width: 1080, height: 1920 } },
  { label: "1920×1080 (16:9)", size: { width: 1920, height: 1080 } },
];

export function isValidSize(s: OutputSize): boolean {
  return (
    s.width >= 240 && s.width <= 4096 && s.width % 2 === 0 &&
    s.height >= 240 && s.height <= 4096 && s.height % 2 === 0
  );
}

interface Props {
  value: OutputSize;
  onChange: (s: OutputSize) => void;
}

export function OutputSizeSelect({ value, onChange }: Props) {
  const matchedPreset = PRESETS.find(
    (p) => p.size.width === value.width && p.size.height === value.height,
  );
  const [mode, setMode] = useState<"preset" | "custom">(matchedPreset ? "preset" : "custom");

  return (
    <div className="space-y-2">
      <select
        value={mode === "preset" && matchedPreset ? matchedPreset.label : "custom"}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setMode("custom");
          } else {
            const p = PRESETS.find((p) => p.label === e.target.value);
            if (p) {
              setMode("preset");
              onChange(p.size);
            }
          }
        }}
        className="w-full border border-border rounded px-2 py-1 text-sm bg-background"
      >
        {PRESETS.map((p) => (
          <option key={p.label} value={p.label}>{p.label}</option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {mode === "custom" && (
        <div className="flex gap-2 items-center">
          <input
            type="number"
            value={value.width}
            onChange={(e) => onChange({ ...value, width: Number(e.target.value) })}
            className="w-20 border border-border rounded px-2 py-1 text-sm"
          />
          <span>×</span>
          <input
            type="number"
            value={value.height}
            onChange={(e) => onChange({ ...value, height: Number(e.target.value) })}
            className="w-20 border border-border rounded px-2 py-1 text-sm"
          />
          {!isValidSize(value) && (
            <span className="text-xs text-destructive">Invalid (need even, 240–4096)</span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/render/output-size-select.tsx
git commit -m "feat(render): OutputSizeSelect with presets + custom"
```

---

## Phase 2 — Field rename indexeddbKey → fileId

Mechanical rename across the codebase. Each commit is a single file/cluster.

### Task 2.1: Rename in auto-match.ts + types

**Files:**
- Modify: `src/lib/auto-match.ts:53-66, 68-83, 92-106, 218-220, 234-236, 244-251`

- [ ] **Step 1: Update ClipMetadata + MatchedClip**

Edit `src/lib/auto-match.ts`:

```typescript
export interface ClipMetadata {
  id: string;
  brollName: string;
  baseName: string;
  durationMs: number;
  fileId: string;          // was: indexeddbKey
  folderId: string;
  productId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface MatchedClip {
  clipId: string;
  fileId: string;          // was: indexeddbKey
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
}
```

Update all references in `auto-match.ts` (search/replace `indexeddbKey` → `fileId` within this file only).

- [ ] **Step 2: Type check the file in isolation**

Run: `pnpm typecheck`
Expected: errors in OTHER files (consumers) — that's fine, will fix in next tasks.

- [ ] **Step 3: Commit (broken intermediate state)**

```bash
git add src/lib/auto-match.ts
git commit -m "refactor(auto-match): rename indexeddbKey to fileId in types"
```

---

### Task 2.2: Update auto-match tests

**Files:**
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/__tests__/lock-preserve.test.ts`
- Modify: `src/lib/__tests__/clip-filter.test.ts`
- Modify: `src/lib/__tests__/playback-plan.test.ts`

- [ ] **Step 1: Replace `indexeddbKey` with `fileId` in test fixtures**

Run: `grep -rn "indexeddbKey" src/lib/__tests__/`

Then in each test file, find every fixture object that includes `indexeddbKey: "..."` or `indexeddbKey,` and rename to `fileId`.

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/lib/__tests__/`
Expected: all green

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/
git commit -m "test: rename indexeddbKey to fileId in fixtures"
```

---

### Task 2.3: Update overlay drag types

**Files:**
- Modify: `src/components/editor/overlay/overlay-drag-source.ts:8, 31`
- Modify: `src/components/editor/overlay/overlay-drag-context.tsx:9`
- Modify: `src/components/editor/overlay/overlay-tracks.tsx:233`
- Modify: `src/components/editor/library/library-panel.tsx:14`
- Modify: any other files with `indexeddbKey:` in overlay/

- [ ] **Step 1: Find all remaining references**

Run: `grep -rn "indexeddbKey" src/`

- [ ] **Step 2: Rename mechanically**

In each match, change `indexeddbKey` → `fileId`. Watch for both type fields and runtime property accesses.

- [ ] **Step 3: Type check**

Run: `pnpm typecheck`
Expected: 0 errors related to `indexeddbKey`. Errors about `getClip(fileId)` are still expected — fixed in Phase 4.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "refactor: rename indexeddbKey to fileId across consumers"
```

---

### Task 2.4: Update API route + render-trigger field

**Files:**
- Modify: `src/app/api/products/[id]/folders/[folderId]/clips/route.ts`
- Modify: `src/app/api/products/[id]/clips/[clipId]/route.ts`
- Modify: `src/components/build/render-trigger.tsx`
- Modify: `src/components/build/section-editor/{chain-strip,variant-grid,preview-pane}.tsx`
- Modify: `src/components/broll/{clip-grid,clip-upload}.tsx`
- Modify: `src/components/editor/timeline/track-clips.tsx`
- Modify: `src/components/editor/preview/preview-player.tsx`
- Modify: `src/components/editor/overlay/{overlay-clip-block,overlay-inspector}.tsx`
- Modify: `src/lib/schema.ts:57`
- Modify: `src/lib/playback-plan.ts`

- [ ] **Step 1: Rename `indexeddbKey` → `fileId` everywhere it still appears**

Run: `grep -rln "indexeddbKey" src/ | xargs -I{} echo "Edit: {}"`

For each file, replace all occurrences of `indexeddbKey` with `fileId`. Schema column stays `indexeddb_key` in the DB (will be deleted in Phase 7 anyway), but Drizzle field name should be `fileId` to match the JS side. For now, just rename property names and string keys uniformly.

- [ ] **Step 2: Verify clean**

Run: `grep -rn "indexeddbKey" src/`
Expected: 0 results

- [ ] **Step 3: Type check**

Run: `pnpm typecheck`
Expected: only errors are about `getClip` / `getThumbnail` not existing (handled in Phase 4) and about API routes (handled in Phase 7).

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "refactor: complete indexeddbKey → fileId rename"
```

---

## Phase 3 — Media pool context + folder picker UI

### Task 3.1: media-pool context

**Files:**
- Create: `src/state/media-pool.tsx`

- [ ] **Step 1: Implement context**

```tsx
// src/state/media-pool.tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ClipMetadata } from "@/lib/auto-match";

export interface AudioFileEntry {
  id: string;
  filename: string;
  file: File;
}

interface MediaPool {
  videos: ClipMetadata[];
  audios: AudioFileEntry[];
  fileMap: Map<string, File>;
  selectedAudioId: string | null;
  setMedia: (videos: ClipMetadata[], audios: AudioFileEntry[], fileMap: Map<string, File>) => void;
  selectAudio: (id: string | null) => void;
  reset: () => void;
  getFileURL: (fileId: string) => string | null;
  getFile: (fileId: string) => File | null;
}

const MediaPoolContext = createContext<MediaPool | null>(null);

export function MediaPoolProvider({ children }: { children: React.ReactNode }) {
  const [videos, setVideos] = useState<ClipMetadata[]>([]);
  const [audios, setAudios] = useState<AudioFileEntry[]>([]);
  const [fileMap, setFileMap] = useState<Map<string, File>>(new Map());
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [urlCache] = useState<Map<string, string>>(new Map());

  const setMedia = useCallback(
    (v: ClipMetadata[], a: AudioFileEntry[], fm: Map<string, File>) => {
      // Revoke old URLs
      for (const url of urlCache.values()) URL.revokeObjectURL(url);
      urlCache.clear();
      setVideos(v);
      setAudios(a);
      setFileMap(fm);
      setSelectedAudioId(null);
    },
    [urlCache],
  );

  const reset = useCallback(() => {
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
    setVideos([]);
    setAudios([]);
    setFileMap(new Map());
    setSelectedAudioId(null);
  }, [urlCache]);

  const getFile = useCallback((fileId: string) => fileMap.get(fileId) ?? null, [fileMap]);

  const getFileURL = useCallback(
    (fileId: string) => {
      const cached = urlCache.get(fileId);
      if (cached) return cached;
      const file = fileMap.get(fileId);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      urlCache.set(fileId, url);
      return url;
    },
    [fileMap, urlCache],
  );

  const value = useMemo<MediaPool>(
    () => ({
      videos, audios, fileMap, selectedAudioId,
      setMedia, selectAudio: setSelectedAudioId, reset, getFileURL, getFile,
    }),
    [videos, audios, fileMap, selectedAudioId, setMedia, reset, getFileURL, getFile],
  );

  return <MediaPoolContext.Provider value={value}>{children}</MediaPoolContext.Provider>;
}

export function useMediaPool(): MediaPool {
  const ctx = useContext(MediaPoolContext);
  if (!ctx) throw new Error("useMediaPool must be inside MediaPoolProvider");
  return ctx;
}
```

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/state/media-pool.tsx
git commit -m "feat(state): MediaPoolProvider with fileMap + URL cache"
```

---

### Task 3.2: folder-picker component

**Files:**
- Create: `src/components/folder-picker.tsx`

- [ ] **Step 1: Implement component**

```tsx
// src/components/folder-picker.tsx
"use client";

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pickFolder } from "@/lib/folder-import";
import { extractVideoMetadata } from "@/lib/video-metadata";
import { useMediaPool, type AudioFileEntry } from "@/state/media-pool";
import { filenameToBrollName, deriveBaseName, isValidBrollName } from "@/lib/broll";
import type { ClipMetadata } from "@/lib/auto-match";

interface Props {
  onLoaded: () => void;
}

export function FolderPicker({ onLoaded }: Props) {
  const { setMedia } = useMediaPool();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  async function handlePick() {
    setError(null);
    setBusy(true);
    try {
      const { videos, audios } = await pickFolder();
      if (videos.length === 0 && audios.length === 0) {
        setError("Không tìm thấy file media nào trong folder này");
        return;
      }
      setProgress({ done: 0, total: videos.length });

      const fileMap = new Map<string, File>();

      const videoMetas: ClipMetadata[] = [];
      let done = 0;
      await Promise.all(
        videos.map(async (file) => {
          try {
            const meta = await extractVideoMetadata(file);
            const fileId = crypto.randomUUID();
            const brollName = filenameToBrollName(file.name);
            if (!isValidBrollName(brollName)) {
              console.warn(`Skipping invalid broll name: ${file.name}`);
              return;
            }
            fileMap.set(fileId, file);
            videoMetas.push({
              id: fileId,
              brollName,
              baseName: deriveBaseName(brollName),
              durationMs: meta.durationMs,
              fileId,
              folderId: "local",
              productId: "local",
              filename: file.name,
              width: meta.width,
              height: meta.height,
              fileSizeBytes: file.size,
              createdAt: new Date(),
            });
          } catch (err) {
            console.warn(`Skipping ${file.name}:`, err);
          } finally {
            done++;
            setProgress({ done, total: videos.length });
          }
        }),
      );

      const audioEntries: AudioFileEntry[] = audios.map((file) => {
        const id = crypto.randomUUID();
        fileMap.set(id, file);
        return { id, filename: file.name, file };
      });

      setMedia(videoMetas, audioEntries, fileMap);
      onLoaded();
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <Button onClick={handlePick} disabled={busy} size="lg">
        {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FolderOpen className="w-5 h-5 mr-2" />}
        Chọn folder B-roll
      </Button>
      {busy && progress.total > 0 && (
        <div className="text-sm text-muted-foreground">
          Loading metadata: {progress.done}/{progress.total}
        </div>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: only pre-existing errors remain.

- [ ] **Step 3: Commit**

```bash
git add src/components/folder-picker.tsx
git commit -m "feat: FolderPicker with progress + error handling"
```

---

## Phase 4 — Migrate consumers from getClip/getThumbnail to media-pool

Replace IndexedDB reads with `mediaPool.getFileURL()` and `mediaPool.getFile()`.

### Task 4.1: preview-player

**Files:**
- Modify: `src/components/editor/preview/preview-player.tsx`

- [ ] **Step 1: Read the current `getClip` usage**

Run: `grep -n "getClip\|clip-storage" src/components/editor/preview/preview-player.tsx`

- [ ] **Step 2: Replace getClip with mediaPool.getFileURL**

Remove import:
```typescript
// DELETE
import { getClip } from "@/lib/clip-storage";
```

Add import:
```typescript
import { useMediaPool } from "@/state/media-pool";
```

Inside component, get the pool: `const mediaPool = useMediaPool();`

For every `await getClip(fileId)` (which returned ArrayBuffer → Blob → URL), replace with direct call:
```typescript
const url = mediaPool.getFileURL(fileId);
if (!url) return; // file gone (folder reset)
```

Skip the Blob creation step entirely — `getFileURL` already returns a usable URL. Remove any `URL.createObjectURL(new Blob(...))` patterns and the corresponding `URL.revokeObjectURL` (the pool owns the URL).

- [ ] **Step 3: Type check**

Run: `pnpm typecheck`
Expected: this file no longer references `getClip`.

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`
Open editor with current product (will fail to load clips since IndexedDB still has old data — OK for now).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/preview/preview-player.tsx
git commit -m "refactor(preview-player): use mediaPool.getFileURL"
```

---

### Task 4.2: overlay system

**Files:**
- Modify: `src/components/editor/overlay/overlay-clip-block.tsx`
- Modify: `src/components/editor/overlay/overlay-inspector.tsx`

- [ ] **Step 1: Replace getClip + getThumbnail in overlay components**

Run: `grep -n "getClip\|getThumbnail\|clip-storage" src/components/editor/overlay/*.tsx`

For each `getClip(fileId)`: replace with `mediaPool.getFileURL(fileId)` (returns URL directly, not ArrayBuffer).

For each `getThumbnail(fileId)`: replace with rendering a `<video src={mediaPool.getFileURL(fileId)} preload="metadata" />` — the browser shows the first frame as poster automatically when paused. Or if a static image is needed, generate via canvas on demand:

```typescript
async function captureFrame(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  await new Promise((r) => video.addEventListener("loadeddata", r, { once: true }));
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0);
  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", 0.7);
}
```

Prefer the `<video preload="metadata">` approach unless a static image is required (e.g., `<img>` consumer).

- [ ] **Step 2: Type check + run**

Run: `pnpm typecheck && pnpm vitest run src/lib/overlay/`
Expected: 0 errors, overlay tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/overlay/
git commit -m "refactor(overlay): use mediaPool for clip URLs"
```

---

### Task 4.3: section-editor + clip-grid

**Files:**
- Modify: `src/components/build/section-editor/chain-strip.tsx`
- Modify: `src/components/build/section-editor/variant-grid.tsx`
- Modify: `src/components/build/section-editor/preview-pane.tsx`
- Modify: `src/components/broll/clip-grid.tsx`
- Modify: `src/components/editor/timeline/track-clips.tsx`
- Modify: `src/components/editor/library/library-panel.tsx`

- [ ] **Step 1: Replace getClip/getThumbnail in each file**

Same pattern as 4.2: import `useMediaPool`, replace `getClip(id)` → `mediaPool.getFileURL(id)`, replace `getThumbnail(id)` → `<video preload="metadata">` poster.

For `clip-grid.tsx`: replace the data source. Currently it fetches via `/api/products/.../clips`. New behavior — read from `mediaPool.videos` directly. Loop through `videos.map((v) => <ClipTile fileId={v.fileId} brollName={v.brollName} />)`.

For `library-panel.tsx`: same data swap — read `mediaPool.videos` and `mediaPool.audios`.

- [ ] **Step 2: Run all tests**

Run: `pnpm vitest run && pnpm typecheck`
Expected: 0 errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/section-editor/ src/components/broll/clip-grid.tsx src/components/editor/timeline/track-clips.tsx src/components/editor/library/library-panel.tsx
git commit -m "refactor(editor): wire all consumers to mediaPool"
```

---

### Task 4.4: script-paste — remove fetch API

**Files:**
- Modify: `src/components/build/script-paste.tsx`

- [ ] **Step 1: Replace API fetch with media-pool read**

Find the block:
```typescript
const clipsRes = await fetch(`/api/products/${productId}/clips`);
const rawClips = await clipsRes.json();
const clips: ClipMetadata[] = rawClips.map((c: any) => ({ ... }));
```

Replace with:
```typescript
const clips = mediaPool.videos;
```

Add `const mediaPool = useMediaPool();` near top of component. Remove the `productId` prop if it's only used for this fetch. Remove unused imports.

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: type errors only in callers of `<ScriptPaste productId={...} />` — fix those callers (likely script-dialog.tsx).

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run`
Expected: pass

- [ ] **Step 4: Commit**

```bash
git add src/components/build/
git commit -m "refactor(script-paste): read clips from mediaPool"
```

---

## Phase 5 — Render worker output size

### Task 5.1: render-worker accepts output size

**Files:**
- Modify: `src/workers/render-worker.ts:70-145`

- [ ] **Step 1: Update message type and filter chain**

In `src/workers/render-worker.ts`, change the destructure on line 70:

```typescript
const { timeline, audioBuffer, clips, outputWidth, outputHeight } = data as {
  timeline: MatchedSection[];
  audioBuffer: ArrayBuffer;
  clips: Record<string, ArrayBuffer>;
  outputWidth: number;
  outputHeight: number;
};
```

In the placeholder branch (line ~103), change `s=1080x1350` to `s=${outputWidth}x${outputHeight}`.

In the actual-clip branch, change the filter from:
```typescript
"-vf", `setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
```

to:
```typescript
"-vf",
`scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
`pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2,` +
`setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
```

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: errors at `worker.postMessage` call sites — fixed in Task 5.2.

- [ ] **Step 3: Commit**

```bash
git add src/workers/render-worker.ts
git commit -m "feat(render-worker): accept outputWidth/Height + scale+pad filter"
```

---

### Task 5.2: render-trigger sends output size + reads from fileMap

**Files:**
- Modify: `src/components/build/render-trigger.tsx`

- [ ] **Step 1: Add output size state + read bytes from media-pool**

Add to imports:
```typescript
import { OutputSizeSelect, type OutputSize, isValidSize } from "@/components/render/output-size-select";
import { useMediaPool } from "@/state/media-pool";
```

Inside component:
```typescript
const mediaPool = useMediaPool();
const [outputSize, setOutputSize] = useState<OutputSize>({ width: 1080, height: 1350 });
```

Replace the existing `getClip` block (around line 122) that builds `clips`:
```typescript
const usedFileIds = new Set<string>();
for (const section of timeline) {
  for (const clip of section.clips) {
    if (clip.fileId) usedFileIds.add(clip.fileId);
  }
}
const clips: Record<string, ArrayBuffer> = {};
for (const fileId of usedFileIds) {
  const file = mediaPool.getFile(fileId);
  if (!file) continue;
  clips[fileId] = await file.arrayBuffer();
}
const audioBuffer = await audioFile.arrayBuffer();
worker.postMessage(
  { cmd: "render", timeline, audioBuffer, clips, outputWidth: outputSize.width, outputHeight: outputSize.height },
  [audioBuffer, ...Object.values(clips)],
);
```

Render the `<OutputSizeSelect value={outputSize} onChange={setOutputSize} />` near the Render button. Disable the button when `!isValidSize(outputSize)`.

Remove the import of `getClip` from `clip-storage`.

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: 0 errors (this file).

- [ ] **Step 3: Commit**

```bash
git add src/components/build/render-trigger.tsx
git commit -m "feat(render): wire OutputSizeSelect + read bytes from mediaPool"
```

---

## Phase 6 — Entry point switch

### Task 6.1: Wrap app with MediaPoolProvider

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Wrap children with MediaPoolProvider**

Add import: `import { MediaPoolProvider } from "@/state/media-pool";`

Wrap the body content (or just the children) with `<MediaPoolProvider>{children}</MediaPoolProvider>`.

- [ ] **Step 2: Type check**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(layout): wrap app with MediaPoolProvider"
```

---

### Task 6.2: New landing page at /

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace redirect with folder picker**

```tsx
// src/app/page.tsx
"use client";

import { useState } from "react";
import { FolderPicker } from "@/components/folder-picker";
import { EditorShell } from "@/components/editor/editor-shell";

export default function Home() {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-2xl font-semibold">VSL Mix-n-Match</h1>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          Chọn folder chứa B-roll (.mp4) + audio (.mp3/.wav). File names quy ước: <code>tag-NN.mp4</code>.
        </p>
        <FolderPicker onLoaded={() => setLoaded(true)} />
      </div>
    );
  }

  return <EditorShell />;
}
```

Note: `EditorShell` currently takes `productId` prop. Remove that prop usage in EditorShell — read from media-pool instead. Search/replace any `productId` references in editor-shell.tsx with media-pool data.

- [ ] **Step 2: Update EditorShell**

In `src/components/editor/editor-shell.tsx`:
- Remove `productId: string` from `EditorShellProps`
- Remove all uses of `productId`
- If editor children take `productId`, replace with media-pool consumption

- [ ] **Step 3: Type check + manual test**

Run: `pnpm typecheck && pnpm dev`
Expected: open `http://localhost:3000`, see folder picker. Click → pick a test folder → editor loads.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/editor/editor-shell.tsx
git commit -m "feat(app): landing folder picker + EditorShell without productId"
```

---

## Phase 7 — Cleanup (delete dead code)

After Phase 6, the new flow works end-to-end. Now remove all dead code in one sweep.

### Task 7.1: Delete API routes + dashboard

**Files:**
- Delete: `src/app/api/products/` (recursive)
- Delete: `src/app/api/diagnostics/`
- Delete: `src/app/dashboard/` (recursive)

- [ ] **Step 1: Verify nothing else imports these**

Run: `grep -rn "/api/products\|/api/diagnostics\|/dashboard" src/`
Expected: 0 results (all consumers should have been migrated in Phase 4).

- [ ] **Step 2: Delete**

```bash
rm -rf src/app/api/products src/app/api/diagnostics src/app/dashboard
```

- [ ] **Step 3: Build check**

Run: `pnpm build:ci`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete API routes + dashboard (replaced by folder picker)"
```

---

### Task 7.2: Delete DB code + clip-storage + clip-upload

**Files:**
- Delete: `src/lib/db.ts`, `src/lib/schema.ts`, `src/lib/clip-storage.ts`
- Delete: `drizzle.config.ts`
- Delete: `drizzle/` (entire folder)
- Delete: `src/components/broll/clip-upload.tsx`
- Delete: `scripts/check-db.mjs`, `scripts/delete-clips.mjs`, `scripts/setup.ts`

- [ ] **Step 1: Verify no imports remain**

Run: `grep -rn "@/lib/db\|@/lib/schema\|@/lib/clip-storage\|clip-upload" src/`
Expected: 0 results.

- [ ] **Step 2: Delete**

```bash
rm src/lib/db.ts src/lib/schema.ts src/lib/clip-storage.ts
rm drizzle.config.ts
rm -rf drizzle
rm src/components/broll/clip-upload.tsx
rm scripts/check-db.mjs scripts/delete-clips.mjs scripts/setup.ts
```

- [ ] **Step 3: Build check**

Run: `pnpm build:ci`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete db/clip-storage/clip-upload + drizzle migrations"
```

---

### Task 7.3: Update env.ts (or delete)

**Files:**
- Modify or delete: `src/lib/env.ts`

- [ ] **Step 1: Decide if env.ts is still needed**

Run: `grep -rn "@/lib/env\|getServerEnv\|getClientEnv\|checkEnv" src/`

If 0 results → delete `src/lib/env.ts`.
If results exist → remove `POSTGRES_URL` from the schema, keep the rest. Also delete the `if (!process.env.POSTGRES_URL)` check inside `checkEnv()`.

- [ ] **Step 2: Verify build**

Run: `pnpm build:ci`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: drop POSTGRES_URL from env"
```

---

### Task 7.4: Update package.json + .env

**Files:**
- Modify: `package.json`
- Modify: `.env`

- [ ] **Step 1: Remove db scripts and drizzle deps**

In `package.json` `"scripts"`, delete: `setup`, `env:check`, `db:generate`, `db:migrate`, `db:push`, `db:studio`, `db:dev`, `db:reset`. Update `build` from `"pnpm run db:migrate && next build"` to `"next build"`.

In `"dependencies"`, delete: `drizzle-orm`, `pg`, `postgres`.
In `"devDependencies"`, delete: `drizzle-kit`, `@types/pg`.

- [ ] **Step 2: Reinstall**

```bash
pnpm install
```

- [ ] **Step 3: Edit .env**

Remove the line `POSTGRES_URL=...`. If `.env` becomes empty, leave it as an empty file (or delete entirely).

- [ ] **Step 4: Verify**

Run: `pnpm dev`
Expected: app starts on http://localhost:3000, no env errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env
git commit -m "chore: remove drizzle deps + POSTGRES_URL"
```

Note: `.env` may be gitignored. If so, only commit `package.json` + `pnpm-lock.yaml`.

---

### Task 7.5: Final smoke test

- [ ] **Step 1: Full test suite**

Run: `pnpm check && pnpm vitest run`
Expected: 0 lint errors, 0 type errors, all tests pass.

- [ ] **Step 2: Manual end-to-end**

1. Run `pnpm dev`
2. Open `http://localhost:3000` in Chrome
3. Click "Chọn folder B-roll"
4. Pick a folder containing 5+ `.mp4` files named `tag-NN.mp4` (e.g., `hook-01.mp4`, `problem-01.mp4`) and 1 `.mp3` file
5. Verify load completes in <1s, editor opens
6. Paste an SRT script with tags matching the folder
7. Verify auto-match populates the timeline
8. Drag the audio file onto the audio track
9. Click Export → choose 1080×1920 → verify output is 1080×1920 vertical
10. Refresh tab → app returns to landing (state cleared, expected)

- [ ] **Step 3: Final commit if any cleanup needed**

If smoke test reveals leftover dead code or warnings, clean up and commit.

```bash
git add -A
git commit -m "chore: post-refactor cleanup"
```

---

## Self-Review Notes

**Spec coverage:**
- Folder picker entry → Phase 3 + 6
- Categorize videos/audios → Task 1.2
- Extract metadata via HTMLVideoElement → Task 1.1
- ClipMetadata.fileId rename → Phase 2
- Auto-match unchanged → tests still pass after Task 2.2
- Audio as drag-able element → covered by media-pool's `audios` array (drag implementation reuses existing track-audio pattern)
- Output size dropdown → Task 1.3 + 5.2
- Resize at render → Task 5.1
- Files removed → Phase 7
- FFmpeg only loads on Export → already true in render-trigger (worker terminates after render)
- Error handling for empty folder, invalid files → covered in folder-picker.tsx
- No persist across refresh → no IndexedDB writes anywhere in new flow

**Risks called out:**
- Memory: render only reads bytes for clips actually used (Task 5.2 collects `usedFileIds` set first)
- Permission: each session re-grants — no persist
- Filename ambiguity: existing `isValidBrollName` skip with warning (folder-picker.tsx)

**Type consistency:**
- `ClipMetadata.fileId` defined in Task 2.1, consumed everywhere as `fileId` thereafter
- `MediaPool` interface defined in Task 3.1, used in Tasks 4.x + 5.2 + 6.x consistently
- `OutputSize` defined in Task 1.3, used in Task 5.2 with `isValidSize` validator

---

## Execution

After completing all 7 phases, the app is full-local. Rollback target: commit `974817b` ("trước khi local full").
