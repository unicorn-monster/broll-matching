# Multi-Folder B-roll Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-folder landing page with in-editor multi-folder B-roll upload (sidebar with per-folder management, IndexedDB persistence, validation dialog, duplicate-name handling, timeline cleanup on delete).

**Architecture:** MediaPool gains a `folders` array and folder-CRUD methods backed by IndexedDB (via `idb` lib). Library panel splits into a left sidebar (`FolderSidebar` wired to MediaPool) and the existing ClipGrid filtered by `activeFolderId`. Three new dialogs handle skipped files, duplicate folder names, and delete confirmation. App page renders EditorShell directly; landing page is removed. Audio persistence is added to BuildStateContext (single file blob).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `idb` v8, shadcn/ui Dialog + AlertDialog, Vitest, fake-indexeddb (test).

**Reference spec:** [docs/superpowers/specs/2026-04-30-multi-folder-broll-upload-design.md](../specs/2026-04-30-multi-folder-broll-upload-design.md)

---

## File Structure

**Create:**
- `src/lib/media-storage.ts` — IDB wrapper using `idb` lib (folders, clips, files, audio, meta stores)
- `src/lib/__tests__/media-storage.test.ts` — IDB CRUD tests using fake-indexeddb
- `src/lib/broll-validation.ts` — `validateBrollFile` with reason taxonomy (single source of truth)
- `src/lib/__tests__/broll-validation.test.ts`
- `src/lib/folder-name-collision.ts` — pure helper for "hook (2)" auto-incrementing
- `src/lib/__tests__/folder-name-collision.test.ts`
- `src/components/ui/alert-dialog.tsx` — shadcn AlertDialog primitive
- `src/components/broll/invalid-files-dialog.tsx`
- `src/components/broll/duplicate-folder-dialog.tsx`
- `src/components/broll/delete-folder-dialog.tsx`

**Modify:**
- `src/state/media-pool.tsx` — replace dead audio array with folders + folder ops + IDB hydration; keep videos/fileMap shape
- `src/lib/auto-match.ts` — drop dead `productId` field from `ClipMetadata`
- `src/components/build/build-state-context.tsx` — add `countOverlaysUsingClips` + `removeOverlaysReferencingClips`; persist audio blob to IDB on `setAudio`, hydrate on mount
- `src/components/editor/library/library-panel.tsx` — left sidebar + filtered grid layout
- `src/components/broll/folder-sidebar.tsx` — refactor: remove inline-name `onCreate`, add `onAdd` (no-arg, opens picker); rest unchanged
- `src/components/editor/editor-shell.tsx` — replace "Back to folder picker" with "Clear all" (opens DeleteFolderDialog in bulk mode)
- `src/app/page.tsx` — render `<EditorShell />` directly
- `src/lib/__tests__/auto-match.test.ts` — drop `productId` from fixtures
- `src/lib/__tests__/lock-preserve.test.ts` — drop `productId` from fixtures
- `package.json` — add `fake-indexeddb` devDep

**Delete:**
- `src/components/folder-picker.tsx`
- `src/components/__tests__/folder-picker.test.tsx`

---

## Task 1: Add fake-indexeddb dev dependency + scaffold media-storage tests

**Files:**
- Modify: `package.json`
- Create: `src/lib/__tests__/media-storage.test.ts`

- [ ] **Step 1: Install fake-indexeddb**

```bash
pnpm add -D fake-indexeddb
```

Run from repo root. Verify it appears in `package.json` `devDependencies`.

- [ ] **Step 2: Create scaffold test file with import-only assertion**

Create `src/lib/__tests__/media-storage.test.ts`:

```ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openMediaDB, deleteMediaDB } from "@/lib/media-storage";

beforeEach(async () => {
  await deleteMediaDB();
});

describe("media-storage", () => {
  it("opens database with all required object stores", async () => {
    const db = await openMediaDB();
    const names = Array.from(db.objectStoreNames).sort();
    expect(names).toEqual(["audio", "clips", "files", "folders", "meta"]);
    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails (module not found)**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: FAIL with "Cannot find module '@/lib/media-storage'"

- [ ] **Step 4: Commit scaffold**

```bash
git add package.json pnpm-lock.yaml src/lib/__tests__/media-storage.test.ts
git commit -m "test(media-storage): scaffold IDB tests with fake-indexeddb"
```

---

## Task 2: Implement media-storage open/delete

**Files:**
- Create: `src/lib/media-storage.ts`
- Test: `src/lib/__tests__/media-storage.test.ts` (already exists)

- [ ] **Step 1: Implement minimal openMediaDB + deleteMediaDB**

Create `src/lib/media-storage.ts`:

```ts
import { openDB, deleteDB, type IDBPDatabase } from "idb";

const DB_NAME = "vsl-mix-n-match";
const DB_VERSION = 1;

export interface FolderRecord {
  id: string;
  name: string;
  createdAt: Date;
}

export interface ClipRecord {
  id: string;
  folderId: string;
  brollName: string;
  baseName: string;
  durationMs: number;
  fileId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface FileRecord {
  id: string;
  blob: Blob;
  type: string;
  filename: string;
}

export interface AudioRecord {
  id: string;             // singleton key "current"
  blob: Blob;
  type: string;
  filename: string;
  durationMs: number;
}

export type MediaDB = IDBPDatabase<unknown>;

export async function openMediaDB(): Promise<MediaDB> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("folders")) {
        db.createObjectStore("folders", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("clips")) {
        const clips = db.createObjectStore("clips", { keyPath: "id" });
        clips.createIndex("folderId", "folderId", { unique: false });
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
}

export async function deleteMediaDB(): Promise<void> {
  await deleteDB(DB_NAME);
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/media-storage.ts
git commit -m "feat(media-storage): open/delete IDB with required stores"
```

---

## Task 3: media-storage — folder + clip + file CRUD

**Files:**
- Modify: `src/lib/media-storage.ts`
- Modify: `src/lib/__tests__/media-storage.test.ts`

- [ ] **Step 1: Add failing tests for folder/clip/file CRUD**

Append to `src/lib/__tests__/media-storage.test.ts`:

```ts
import {
  addFolderWithClips,
  getAllFolders,
  getAllClips,
  getFile,
  removeFolder,
  renameFolder,
  type FolderRecord,
  type ClipRecord,
  type FileRecord,
} from "@/lib/media-storage";

function makeClip(folderId: string, name: string, fileId: string): { clip: ClipRecord; file: FileRecord } {
  return {
    clip: {
      id: crypto.randomUUID(),
      folderId,
      brollName: name,
      baseName: name.replace(/-\d+$/, ""),
      durationMs: 1000,
      fileId,
      filename: `${name}.mp4`,
      width: 1920,
      height: 1080,
      fileSizeBytes: 100,
      createdAt: new Date(),
    },
    file: {
      id: fileId,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
      type: "video/mp4",
      filename: `${name}.mp4`,
    },
  };
}

describe("addFolderWithClips + reads", () => {
  it("persists folder, clips, and files in one operation", async () => {
    const folder: FolderRecord = { id: "f1", name: "hook", createdAt: new Date() };
    const f1 = crypto.randomUUID();
    const f2 = crypto.randomUUID();
    const e1 = makeClip("f1", "hook-01", f1);
    const e2 = makeClip("f1", "hook-02", f2);

    await addFolderWithClips(folder, [e1.clip, e2.clip], [e1.file, e2.file]);

    const folders = await getAllFolders();
    const clips = await getAllClips();
    const file = await getFile(f1);

    expect(folders).toHaveLength(1);
    expect(folders[0]!.name).toBe("hook");
    expect(clips).toHaveLength(2);
    expect(file).not.toBeNull();
    expect(file!.filename).toBe("hook-01.mp4");
  });
});

describe("removeFolder", () => {
  it("removes folder and cascades to its clips and files", async () => {
    const folderA: FolderRecord = { id: "fa", name: "a", createdAt: new Date() };
    const folderB: FolderRecord = { id: "fb", name: "b", createdAt: new Date() };
    const a1 = makeClip("fa", "a-01", crypto.randomUUID());
    const b1 = makeClip("fb", "b-01", crypto.randomUUID());

    await addFolderWithClips(folderA, [a1.clip], [a1.file]);
    await addFolderWithClips(folderB, [b1.clip], [b1.file]);

    await removeFolder("fa");

    const folders = await getAllFolders();
    const clips = await getAllClips();
    expect(folders.map((f) => f.id)).toEqual(["fb"]);
    expect(clips.map((c) => c.id)).toEqual([b1.clip.id]);
    expect(await getFile(a1.file.id)).toBeNull();
    expect(await getFile(b1.file.id)).not.toBeNull();
  });
});

describe("renameFolder", () => {
  it("updates only the folder name, leaves clips untouched", async () => {
    const folder: FolderRecord = { id: "f1", name: "old", createdAt: new Date() };
    const c1 = makeClip("f1", "x-01", crypto.randomUUID());
    await addFolderWithClips(folder, [c1.clip], [c1.file]);

    await renameFolder("f1", "new");

    const folders = await getAllFolders();
    const clips = await getAllClips();
    expect(folders[0]!.name).toBe("new");
    expect(clips[0]!.brollName).toBe("x-01");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement folder/clip/file CRUD in media-storage.ts**

Append to `src/lib/media-storage.ts`:

```ts
export async function addFolderWithClips(
  folder: FolderRecord,
  clips: ClipRecord[],
  files: FileRecord[],
): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["folders", "clips", "files"], "readwrite");
  await Promise.all([
    tx.objectStore("folders").put(folder),
    ...clips.map((c) => tx.objectStore("clips").put(c)),
    ...files.map((f) => tx.objectStore("files").put(f)),
    tx.done,
  ]);
  db.close();
}

export async function getAllFolders(): Promise<FolderRecord[]> {
  const db = await openMediaDB();
  const all = await db.getAll("folders");
  db.close();
  return all as FolderRecord[];
}

export async function getAllClips(): Promise<ClipRecord[]> {
  const db = await openMediaDB();
  const all = await db.getAll("clips");
  db.close();
  return all as ClipRecord[];
}

export async function getFile(id: string): Promise<FileRecord | null> {
  const db = await openMediaDB();
  const rec = (await db.get("files", id)) as FileRecord | undefined;
  db.close();
  return rec ?? null;
}

export async function removeFolder(folderId: string): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["folders", "clips", "files"], "readwrite");
  const clipsStore = tx.objectStore("clips");
  const folderClips = (await clipsStore.index("folderId").getAll(folderId)) as ClipRecord[];
  await Promise.all([
    tx.objectStore("folders").delete(folderId),
    ...folderClips.map((c) => clipsStore.delete(c.id)),
    ...folderClips.map((c) => tx.objectStore("files").delete(c.fileId)),
    tx.done,
  ]);
  db.close();
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction("folders", "readwrite");
  const existing = (await tx.objectStore("folders").get(id)) as FolderRecord | undefined;
  if (existing) {
    await tx.objectStore("folders").put({ ...existing, name });
  }
  await tx.done;
  db.close();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-storage.ts src/lib/__tests__/media-storage.test.ts
git commit -m "feat(media-storage): folder/clip/file CRUD with cascade delete"
```

---

## Task 4: media-storage — audio singleton + reset

**Files:**
- Modify: `src/lib/media-storage.ts`
- Modify: `src/lib/__tests__/media-storage.test.ts`

- [ ] **Step 1: Add failing tests for audio + resetAll**

Append to `src/lib/__tests__/media-storage.test.ts`:

```ts
import { putAudio, getAudio, clearAudio, resetAll, type AudioRecord } from "@/lib/media-storage";

describe("audio singleton", () => {
  it("stores and retrieves a single audio record", async () => {
    const audio: AudioRecord = {
      id: "current",
      blob: new Blob([new Uint8Array([0, 1])], { type: "audio/mp3" }),
      type: "audio/mp3",
      filename: "song.mp3",
      durationMs: 30000,
    };
    await putAudio(audio);
    const got = await getAudio();
    expect(got?.filename).toBe("song.mp3");
    expect(got?.durationMs).toBe(30000);
  });

  it("clearAudio removes the singleton", async () => {
    const audio: AudioRecord = {
      id: "current",
      blob: new Blob([], { type: "audio/mp3" }),
      type: "audio/mp3",
      filename: "x.mp3",
      durationMs: 0,
    };
    await putAudio(audio);
    await clearAudio();
    expect(await getAudio()).toBeNull();
  });
});

describe("resetAll", () => {
  it("wipes folders, clips, files, and audio", async () => {
    const folder: FolderRecord = { id: "f1", name: "x", createdAt: new Date() };
    const c1 = makeClip("f1", "x-01", crypto.randomUUID());
    await addFolderWithClips(folder, [c1.clip], [c1.file]);
    await putAudio({
      id: "current",
      blob: new Blob([], { type: "audio/mp3" }),
      type: "audio/mp3",
      filename: "x.mp3",
      durationMs: 0,
    });

    await resetAll();

    expect(await getAllFolders()).toEqual([]);
    expect(await getAllClips()).toEqual([]);
    expect(await getAudio()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement audio + resetAll**

Append to `src/lib/media-storage.ts`:

```ts
const AUDIO_KEY = "current";

export async function putAudio(audio: AudioRecord): Promise<void> {
  const db = await openMediaDB();
  await db.put("audio", { ...audio, id: AUDIO_KEY });
  db.close();
}

export async function getAudio(): Promise<AudioRecord | null> {
  const db = await openMediaDB();
  const rec = (await db.get("audio", AUDIO_KEY)) as AudioRecord | undefined;
  db.close();
  return rec ?? null;
}

export async function clearAudio(): Promise<void> {
  const db = await openMediaDB();
  await db.delete("audio", AUDIO_KEY);
  db.close();
}

export async function resetAll(): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["folders", "clips", "files", "audio", "meta"], "readwrite");
  await Promise.all([
    tx.objectStore("folders").clear(),
    tx.objectStore("clips").clear(),
    tx.objectStore("files").clear(),
    tx.objectStore("audio").clear(),
    tx.objectStore("meta").clear(),
    tx.done,
  ]);
  db.close();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/__tests__/media-storage.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-storage.ts src/lib/__tests__/media-storage.test.ts
git commit -m "feat(media-storage): audio singleton + resetAll"
```

---

## Task 5: broll-validation with reason taxonomy

**Files:**
- Create: `src/lib/broll-validation.ts`
- Create: `src/lib/__tests__/broll-validation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/broll-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateBrollFile } from "@/lib/broll-validation";

function file(name: string): File {
  return new File([new Uint8Array([0])], name);
}

describe("validateBrollFile", () => {
  it("accepts well-formed lowercase tag-NN.mp4", () => {
    const r = validateBrollFile(file("hook-01.mp4"));
    expect(r).toEqual({ valid: true, brollName: "hook-01" });
  });

  it("accepts multi-segment tag like before-after-12.mov", () => {
    const r = validateBrollFile(file("before-after-12.mov"));
    expect(r).toEqual({ valid: true, brollName: "before-after-12" });
  });

  it("accepts .webm", () => {
    const r = validateBrollFile(file("x-1.webm"));
    expect(r.valid).toBe(true);
  });

  it("rejects non-video extension as 'not a video file'", () => {
    expect(validateBrollFile(file("notes.txt"))).toEqual({
      valid: false,
      reason: "not a video file",
    });
  });

  it("rejects no extension as 'not a video file'", () => {
    expect(validateBrollFile(file("hook-01"))).toEqual({
      valid: false,
      reason: "not a video file",
    });
  });

  it("rejects uppercase as 'must be lowercase, no spaces'", () => {
    expect(validateBrollFile(file("Hook-01.mp4"))).toEqual({
      valid: false,
      reason: "must be lowercase, no spaces",
    });
  });

  it("rejects whitespace as 'must be lowercase, no spaces'", () => {
    expect(validateBrollFile(file("hook 01.mp4"))).toEqual({
      valid: false,
      reason: "must be lowercase, no spaces",
    });
  });

  it("rejects missing -NN as 'must end with -NN'", () => {
    expect(validateBrollFile(file("hook.mp4"))).toEqual({
      valid: false,
      reason: "must end with -NN",
    });
  });

  it("rejects underscore-separated as 'must end with -NN'", () => {
    expect(validateBrollFile(file("hook_01.mp4"))).toEqual({
      valid: false,
      reason: "must end with -NN",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/__tests__/broll-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement validateBrollFile**

Create `src/lib/broll-validation.ts`:

```ts
const VIDEO_EXTS = [".mp4", ".mov", ".webm"];
const BROLL_PATTERN = /^[a-z0-9-]+-\d+$/;

export type SkippedReason =
  | "not a video file"
  | "must be lowercase, no spaces"
  | "must end with -NN"
  | "must match tag-NN pattern"
  | "broll name already exists in this folder";

export type ValidationResult =
  | { valid: true; brollName: string }
  | { valid: false; reason: SkippedReason };

export function validateBrollFile(file: File): ValidationResult {
  const name = file.name;
  const lower = name.toLowerCase();
  const matchedExt = VIDEO_EXTS.find((e) => lower.endsWith(e));
  if (!matchedExt) return { valid: false, reason: "not a video file" };

  const stem = name.slice(0, name.length - matchedExt.length);

  if (stem !== stem.toLowerCase() || /\s/.test(stem)) {
    return { valid: false, reason: "must be lowercase, no spaces" };
  }

  if (BROLL_PATTERN.test(stem)) {
    return { valid: true, brollName: stem };
  }

  if (!/-\d+$/.test(stem)) {
    return { valid: false, reason: "must end with -NN" };
  }

  return { valid: false, reason: "must match tag-NN pattern" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/__tests__/broll-validation.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/broll-validation.ts src/lib/__tests__/broll-validation.test.ts
git commit -m "feat(broll-validation): file validation with reason taxonomy"
```

---

## Task 6: folder-name-collision helper

**Files:**
- Create: `src/lib/folder-name-collision.ts`
- Create: `src/lib/__tests__/folder-name-collision.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/folder-name-collision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCollidingFolderName } from "@/lib/folder-name-collision";

describe("resolveCollidingFolderName", () => {
  it("returns base name unchanged when no collision", () => {
    expect(resolveCollidingFolderName("hook", ["other"])).toBe("hook");
  });

  it("appends (2) on first collision", () => {
    expect(resolveCollidingFolderName("hook", ["hook"])).toBe("hook (2)");
  });

  it("walks to (3) when (2) also exists", () => {
    expect(resolveCollidingFolderName("hook", ["hook", "hook (2)"])).toBe("hook (3)");
  });

  it("ignores unrelated parenthesized names", () => {
    expect(resolveCollidingFolderName("hook", ["hook", "intro (2)"])).toBe("hook (2)");
  });

  it("handles names that already end in (n) literally", () => {
    expect(resolveCollidingFolderName("hook (2)", ["hook (2)"])).toBe("hook (2) (2)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/__tests__/folder-name-collision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement resolver**

Create `src/lib/folder-name-collision.ts`:

```ts
export function resolveCollidingFolderName(base: string, existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/__tests__/folder-name-collision.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/folder-name-collision.ts src/lib/__tests__/folder-name-collision.test.ts
git commit -m "feat(folder-name-collision): resolve duplicate folder names"
```

---

## Task 7: Drop dead `productId` field from ClipMetadata

**Files:**
- Modify: `src/lib/auto-match.ts:53-66`
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/__tests__/lock-preserve.test.ts`
- Modify: `src/components/folder-picker.tsx:55` (will be deleted later, but must compile now)
- Modify: `src/components/__tests__/folder-picker.test.tsx:90` (will be deleted later)

- [ ] **Step 1: Remove productId from ClipMetadata interface**

Edit `src/lib/auto-match.ts`:

Find:
```ts
  folderId: string;
  productId: string;
  filename: string;
```
Replace with:
```ts
  folderId: string;
  filename: string;
```

- [ ] **Step 2: Remove productId from test fixtures**

In `src/lib/__tests__/auto-match.test.ts` and `src/lib/__tests__/lock-preserve.test.ts`, find each line `productId: "p1",` (or similar) and delete it.

In `src/components/folder-picker.tsx` line 55, delete `productId: "local",`.
In `src/components/__tests__/folder-picker.test.tsx` line 90, delete `productId: "local",`.

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts src/lib/__tests__/lock-preserve.test.ts src/components/folder-picker.tsx src/components/__tests__/folder-picker.test.tsx
git commit -m "refactor(auto-match): drop dead productId field from ClipMetadata"
```

---

## Task 8: Add shadcn AlertDialog primitive

**Files:**
- Create: `src/components/ui/alert-dialog.tsx`

- [ ] **Step 1: Add via shadcn CLI**

```bash
pnpm dlx shadcn@latest add alert-dialog
```

When prompted, accept defaults (overwrites nothing — file is new).

- [ ] **Step 2: Verify file exists and exports expected components**

```bash
grep -E "^export (function|const) (AlertDialog|AlertDialogAction|AlertDialogCancel|AlertDialogContent|AlertDialogDescription|AlertDialogFooter|AlertDialogHeader|AlertDialogTitle|AlertDialogTrigger)" src/components/ui/alert-dialog.tsx
```

Expected: all 9 names present.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/alert-dialog.tsx package.json pnpm-lock.yaml
git commit -m "chore(ui): add shadcn AlertDialog primitive"
```

---

## Task 9: MediaPool — replace dead audio array with folders + hydration scaffolding

**Files:**
- Modify: `src/state/media-pool.tsx`

This task only changes the type surface and adds an empty `folders` array + `hydrated: false` flag. Subsequent tasks fill in the operations. Splitting this way keeps each diff small.

- [ ] **Step 1: Rewrite media-pool.tsx with new shape**

Replace entire contents of `src/state/media-pool.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClipMetadata } from "@/lib/auto-match";
import {
  getAllClips,
  getAllFolders,
  getFile as getFileRecord,
  type FolderRecord,
} from "@/lib/media-storage";

export interface FolderEntry {
  id: string;
  name: string;
  createdAt: Date;
}

export interface AddFolderResult {
  folderId: string;
  added: number;
  skipped: { filename: string; reason: string }[];
}

interface MediaPool {
  videos: ClipMetadata[];
  fileMap: Map<string, File>;
  folders: FolderEntry[];
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  hydrated: boolean;

  addFolder: (name: string, files: File[], options?: { mergeIntoFolderId?: string }) => Promise<AddFolderResult>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  reset: () => Promise<void>;

  getFile: (fileId: string) => File | null;
  getFileURL: (fileId: string) => string | null;
}

const MediaPoolContext = createContext<MediaPool | null>(null);

function notImplemented(): never {
  throw new Error("MediaPool method not yet implemented");
}

export function MediaPoolProvider({ children }: { children: React.ReactNode }) {
  const [videos, setVideos] = useState<ClipMetadata[]>([]);
  const [fileMap, setFileMap] = useState<Map<string, File>>(new Map());
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const urlCacheRef = useRef<Map<string, string>>(new Map());

  // Hydrate from IDB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [folderRecs, clipRecs] = await Promise.all([getAllFolders(), getAllClips()]);
      if (cancelled) return;

      const newFileMap = new Map<string, File>();
      await Promise.all(
        clipRecs.map(async (c) => {
          const fr = await getFileRecord(c.fileId);
          if (fr) {
            newFileMap.set(c.fileId, new File([fr.blob], fr.filename, { type: fr.type }));
          }
        }),
      );

      if (cancelled) return;

      const clips: ClipMetadata[] = clipRecs.map((c) => ({
        id: c.id,
        brollName: c.brollName,
        baseName: c.baseName,
        durationMs: c.durationMs,
        fileId: c.fileId,
        folderId: c.folderId,
        filename: c.filename,
        width: c.width,
        height: c.height,
        fileSizeBytes: c.fileSizeBytes,
        createdAt: c.createdAt,
      }));

      setFolders(folderRecs.map((f: FolderRecord) => ({ id: f.id, name: f.name, createdAt: f.createdAt })));
      setVideos(clips);
      setFileMap(newFileMap);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getFile = useCallback((fileId: string) => fileMap.get(fileId) ?? null, [fileMap]);

  const getFileURL = useCallback(
    (fileId: string) => {
      const cache = urlCacheRef.current;
      const cached = cache.get(fileId);
      if (cached) return cached;
      const file = fileMap.get(fileId);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      cache.set(fileId, url);
      return url;
    },
    [fileMap],
  );

  const addFolder = useCallback(async (): Promise<AddFolderResult> => notImplemented(), []);
  const renameFolder = useCallback(async () => notImplemented(), []);
  const removeFolder = useCallback(async () => notImplemented(), []);
  const reset = useCallback(async () => notImplemented(), []);

  const value = useMemo<MediaPool>(
    () => ({
      videos,
      fileMap,
      folders,
      activeFolderId,
      setActiveFolderId,
      hydrated,
      addFolder,
      renameFolder,
      removeFolder,
      reset,
      getFile,
      getFileURL,
    }),
    [videos, fileMap, folders, activeFolderId, hydrated, addFolder, renameFolder, removeFolder, reset, getFile, getFileURL],
  );

  return <MediaPoolContext.Provider value={value}>{children}</MediaPoolContext.Provider>;
}

export function useMediaPool(): MediaPool {
  const ctx = useContext(MediaPoolContext);
  if (!ctx) throw new Error("useMediaPool must be inside MediaPoolProvider");
  return ctx;
}
```

- [ ] **Step 2: Build will fail because old consumers reference removed `audios`/`selectedAudioId`/`setMedia`. Run typecheck to enumerate:**

Run: `pnpm typecheck 2>&1 | head -40`

Expected: errors in `folder-picker.tsx` (uses `setMedia`, `AudioFileEntry`).

- [ ] **Step 3: Stub folder-picker.tsx so the build passes (it will be deleted in Task 16)**

Edit `src/components/folder-picker.tsx`. Replace entire contents with:

```tsx
// File scheduled for deletion in Task 16. Stubbed to keep the build green
// after MediaPool refactor in Task 9.
"use client";
export function FolderPicker(_props: { onLoaded: () => void }) {
  return null;
}
```

Also edit `src/components/__tests__/folder-picker.test.tsx` — remove the `clipMetadata` block at lines ~78-102 (the only block that referenced the old shape) so tests pass. Keep the rest of the file intact for now.

Actually replace the entire `clip metadata construction` describe block:

Find:
```ts
  describe("clip metadata construction", () => {
```
…through its closing `});` and delete it entirely.

- [ ] **Step 4: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/media-pool.tsx src/components/folder-picker.tsx src/components/__tests__/folder-picker.test.tsx
git commit -m "refactor(media-pool): replace dead audio array with folder state + IDB hydration scaffold"
```

---

## Task 10: MediaPool — implement addFolder

**Files:**
- Modify: `src/state/media-pool.tsx`

- [ ] **Step 1: Implement addFolder in media-pool.tsx**

Replace the placeholder `addFolder` callback with:

```tsx
const addFolder = useCallback(
  async (
    name: string,
    files: File[],
    options?: { mergeIntoFolderId?: string },
  ): Promise<AddFolderResult> => {
    const { addFolderWithClips } = await import("@/lib/media-storage");
    const { validateBrollFile } = await import("@/lib/broll-validation");
    const { extractVideoMetadata } = await import("@/lib/video-metadata");
    const { deriveBaseName } = await import("@/lib/broll");

    const folderId = options?.mergeIntoFolderId ?? crypto.randomUUID();
    const folderRec = options?.mergeIntoFolderId
      ? folders.find((f) => f.id === folderId)!
      : { id: folderId, name, createdAt: new Date() };

    const skipped: { filename: string; reason: string }[] = [];
    const existingNamesInFolder = new Set(
      videos.filter((v) => v.folderId === folderId).map((v) => v.brollName),
    );

    const acceptedClips: ClipMetadata[] = [];
    const acceptedFiles: { id: string; blob: Blob; type: string; filename: string }[] = [];

    await Promise.all(
      files.map(async (file) => {
        const result = validateBrollFile(file);
        if (!result.valid) {
          skipped.push({ filename: file.name, reason: result.reason });
          return;
        }
        if (existingNamesInFolder.has(result.brollName)) {
          skipped.push({ filename: file.name, reason: "broll name already exists in this folder" });
          return;
        }
        try {
          const meta = await extractVideoMetadata(file);
          const fileId = crypto.randomUUID();
          acceptedClips.push({
            id: fileId,
            brollName: result.brollName,
            baseName: deriveBaseName(result.brollName),
            durationMs: meta.durationMs,
            fileId,
            folderId,
            filename: file.name,
            width: meta.width,
            height: meta.height,
            fileSizeBytes: file.size,
            createdAt: new Date(),
          });
          acceptedFiles.push({ id: fileId, blob: file, type: file.type, filename: file.name });
        } catch {
          skipped.push({ filename: file.name, reason: "failed to read video metadata" });
        }
      }),
    );

    await addFolderWithClips(
      { id: folderRec.id, name: folderRec.name, createdAt: folderRec.createdAt },
      acceptedClips.map((c) => ({
        id: c.id,
        folderId: c.folderId,
        brollName: c.brollName,
        baseName: c.baseName,
        durationMs: c.durationMs,
        fileId: c.fileId,
        filename: c.filename,
        width: c.width,
        height: c.height,
        fileSizeBytes: c.fileSizeBytes,
        createdAt: c.createdAt,
      })),
      acceptedFiles,
    );

    setFolders((prev) =>
      options?.mergeIntoFolderId ? prev : [...prev, { id: folderRec.id, name: folderRec.name, createdAt: folderRec.createdAt }],
    );
    setVideos((prev) => [...prev, ...acceptedClips]);
    setFileMap((prev) => {
      const next = new Map(prev);
      for (const af of acceptedFiles) {
        next.set(af.id, new File([af.blob], af.filename, { type: af.type }));
      }
      return next;
    });

    return { folderId, added: acceptedClips.length, skipped };
  },
  [folders, videos],
);
```

Note: `"failed to read video metadata"` is added as an additional skipped reason — extend `SkippedReason` type if needed.

- [ ] **Step 2: Add the new reason to broll-validation type**

Edit `src/lib/broll-validation.ts`:

Find:
```ts
export type SkippedReason =
  | "not a video file"
  | "must be lowercase, no spaces"
  | "must end with -NN"
  | "must match tag-NN pattern"
  | "broll name already exists in this folder";
```
Replace with:
```ts
export type SkippedReason =
  | "not a video file"
  | "must be lowercase, no spaces"
  | "must end with -NN"
  | "must match tag-NN pattern"
  | "broll name already exists in this folder"
  | "failed to read video metadata";
```

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/state/media-pool.tsx src/lib/broll-validation.ts
git commit -m "feat(media-pool): implement addFolder with validation + IDB persist"
```

---

## Task 11: MediaPool — implement removeFolder + renameFolder + reset

**Files:**
- Modify: `src/state/media-pool.tsx`

- [ ] **Step 1: Implement the three remaining ops**

Replace the placeholder callbacks:

```tsx
const removeFolder = useCallback(
  async (id: string) => {
    const { removeFolder: removeFolderIDB } = await import("@/lib/media-storage");
    const folderClipFileIds = videos.filter((v) => v.folderId === id).map((v) => v.fileId);

    await removeFolderIDB(id);

    const cache = urlCacheRef.current;
    for (const fileId of folderClipFileIds) {
      const url = cache.get(fileId);
      if (url) {
        URL.revokeObjectURL(url);
        cache.delete(fileId);
      }
    }

    setFolders((prev) => prev.filter((f) => f.id !== id));
    setVideos((prev) => prev.filter((v) => v.folderId !== id));
    setFileMap((prev) => {
      const next = new Map(prev);
      for (const fid of folderClipFileIds) next.delete(fid);
      return next;
    });
    setActiveFolderId((cur) => (cur === id ? null : cur));
  },
  [videos],
);

const renameFolder = useCallback(async (id: string, name: string) => {
  const { renameFolder: renameFolderIDB } = await import("@/lib/media-storage");
  await renameFolderIDB(id, name);
  setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
}, []);

const reset = useCallback(async () => {
  const { resetAll } = await import("@/lib/media-storage");
  await resetAll();
  const cache = urlCacheRef.current;
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  setFolders([]);
  setVideos([]);
  setFileMap(new Map());
  setActiveFolderId(null);
}, []);
```

- [ ] **Step 2: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/state/media-pool.tsx
git commit -m "feat(media-pool): implement removeFolder/renameFolder/reset"
```

---

## Task 12: BuildState — overlay cleanup helpers

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Add countOverlaysUsingClips and removeOverlaysReferencingClips**

Edit `src/components/build/build-state-context.tsx`. In the `BuildState` interface, after `setSelectedOverlayId`, add:

```ts
  countOverlaysUsingClips: (clipIds: string[]) => number;
  removeOverlaysReferencingClips: (clipIds: string[]) => number;
```

In the provider body, after the `setOverlays` callback, add:

```tsx
const countOverlaysUsingClips = useCallback(
  (clipIds: string[]) => {
    const set = new Set(clipIds);
    return overlays.filter((o) => set.has(o.clipId)).length;
  },
  [overlays],
);

const removeOverlaysReferencingClips = useCallback(
  (clipIds: string[]) => {
    const set = new Set(clipIds);
    let removed = 0;
    setOverlaysState((prev) => {
      const next = prev.filter((o) => {
        if (set.has(o.clipId)) {
          removed++;
          return false;
        }
        return true;
      });
      return next;
    });
    return removed;
  },
  [],
);
```

In the `value = useMemo` object, add the two new functions to the returned shape and to the deps array (none actually needed since the funcs are wrapped in useCallback — leave deps unchanged but include them in the returned object).

- [ ] **Step 2: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(build-state): add overlay cleanup helpers for folder delete"
```

---

## Task 13: BuildState — persist audio file to IDB

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Persist on setAudio + hydrate on mount**

Edit `src/components/build/build-state-context.tsx`:

Find the `setAudio` function:
```tsx
function setAudio(file: File | null, duration: number | null) {
  setAudioFile(file);
  setAudioDuration(duration);
}
```

Replace with:
```tsx
async function setAudio(file: File | null, duration: number | null) {
  setAudioFile(file);
  setAudioDuration(duration);
  const { putAudio, clearAudio } = await import("@/lib/media-storage");
  if (file) {
    await putAudio({
      id: "current",
      blob: file,
      type: file.type,
      filename: file.name,
      durationMs: duration ?? 0,
    });
  } else {
    await clearAudio();
  }
}
```

After the existing `useState` declarations in `BuildStateProvider`, add a hydration effect:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    const { getAudio } = await import("@/lib/media-storage");
    const rec = await getAudio();
    if (cancelled || !rec) return;
    const file = new File([rec.blob], rec.filename, { type: rec.type });
    setAudioFile(file);
    setAudioDuration(rec.durationMs);
  })();
  return () => {
    cancelled = true;
  };
}, []);
```

Add `useEffect` to the React imports at the top of the file if not present.

- [ ] **Step 2: Run typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(build-state): persist audio file blob to IDB"
```

---

## Task 14: InvalidFilesDialog component

**Files:**
- Create: `src/components/broll/invalid-files-dialog.tsx`

- [ ] **Step 1: Implement component**

Create `src/components/broll/invalid-files-dialog.tsx`:

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface SkippedItem {
  filename: string;
  reason: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  added: number;
  skipped: SkippedItem[];
}

export function InvalidFilesDialog({ open, onOpenChange, folderName, added, skipped }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Some files were skipped</DialogTitle>
          <DialogDescription>
            Folder &ldquo;{folderName}&rdquo; uploaded with {added} valid {added === 1 ? "clip" : "clips"}.
            {" "}{skipped.length} {skipped.length === 1 ? "file was" : "files were"} skipped because their
            names don&apos;t match the required pattern.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-xs">
          <p>
            <span className="font-medium">Required:</span> <code>tag-NN.mp4</code>{" "}
            <span className="text-muted-foreground">
              (lowercase tag + dash + number, e.g. <code>hook-01.mp4</code>)
            </span>
          </p>
          <div className="border border-border rounded max-h-64 overflow-y-auto divide-y divide-border">
            {skipped.map((s, i) => (
              <div key={i} className="p-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-mono truncate">{s.filename}</div>
                  <div className="text-muted-foreground">Reason: {s.reason}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground">Rename the files and re-upload the folder.</p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/broll/invalid-files-dialog.tsx
git commit -m "feat(broll): add InvalidFilesDialog"
```

---

## Task 15: DuplicateFolderDialog component

**Files:**
- Create: `src/components/broll/duplicate-folder-dialog.tsx`

- [ ] **Step 1: Implement component**

Create `src/components/broll/duplicate-folder-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type DuplicateAction = "new" | "merge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFolderName: string;
  existingClipCount: number;
  proposedNewName: string;
  onChoose: (action: DuplicateAction) => void;
}

export function DuplicateFolderDialog({
  open,
  onOpenChange,
  existingFolderName,
  existingClipCount,
  proposedNewName,
  onChoose,
}: Props) {
  const [action, setAction] = useState<DuplicateAction>("new");

  function handleContinue() {
    onChoose(action);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Folder &ldquo;{existingFolderName}&rdquo; already exists</DialogTitle>
          <DialogDescription>
            You already have a folder named &ldquo;{existingFolderName}&rdquo; with {existingClipCount}{" "}
            {existingClipCount === 1 ? "clip" : "clips"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>How would you like to add the new files?</p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-action"
              value="new"
              checked={action === "new"}
              onChange={() => setAction("new")}
              className="mt-1"
            />
            <span>
              Add as a new folder &ldquo;<span className="font-mono">{proposedNewName}</span>&rdquo;
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-action"
              value="merge"
              checked={action === "merge"}
              onChange={() => setAction("merge")}
              className="mt-1"
            />
            <span>
              Merge into existing &ldquo;{existingFolderName}&rdquo;
              <br />
              <span className="text-xs text-muted-foreground">
                (skip files with duplicate broll names)
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleContinue}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/broll/duplicate-folder-dialog.tsx
git commit -m "feat(broll): add DuplicateFolderDialog"
```

---

## Task 16: DeleteFolderDialog component

**Files:**
- Create: `src/components/broll/delete-folder-dialog.tsx`

- [ ] **Step 1: Implement component**

Create `src/components/broll/delete-folder-dialog.tsx`:

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;        // for bulk reset, pass "all folders"
  clipCount: number;
  usedCount: number;
  onConfirm: () => void;
  bulk?: boolean;            // changes wording for "Clear all"
  audioCount?: number;       // bulk-only
  folderCount?: number;      // bulk-only
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderName,
  clipCount,
  usedCount,
  onConfirm,
  bulk = false,
  audioCount = 0,
  folderCount = 0,
}: Props) {
  const title = bulk
    ? "Clear entire project?"
    : `Delete folder "${folderName}"?`;

  const description = bulk ? (
    <>
      This will delete <strong>{folderCount}</strong>{" "}
      {folderCount === 1 ? "folder" : "folders"}, <strong>{clipCount}</strong>{" "}
      {clipCount === 1 ? "clip" : "clips"}
      {audioCount > 0 ? <>, and <strong>1</strong> audio</> : null}.
    </>
  ) : (
    <>
      This will permanently delete the folder and{" "}
      <strong>
        {clipCount} {clipCount === 1 ? "clip" : "clips"}
      </strong>
      .
    </>
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {usedCount > 0 ? (
          <div className="flex items-start gap-2 text-sm rounded border border-amber-500/40 bg-amber-500/10 p-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              {usedCount} {usedCount === 1 ? "overlay" : "overlays"} in your timeline{" "}
              {usedCount === 1 ? "uses" : "use"} clips from {bulk ? "these folders" : "this folder"}.
              {" "}They will be removed.
            </span>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">This cannot be undone.</p>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            {bulk ? "Clear all" : "Delete folder"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/broll/delete-folder-dialog.tsx
git commit -m "feat(broll): add DeleteFolderDialog with single + bulk variants"
```

---

## Task 17: Refactor folder-sidebar.tsx — replace inline-create with onAdd

**Files:**
- Modify: `src/components/broll/folder-sidebar.tsx`

- [ ] **Step 1: Refactor props and remove inline name input**

Replace entire contents of `src/components/broll/folder-sidebar.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, FolderOpen, Library, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Folder = { id: string; name: string; clipCount: number };

interface FolderSidebarProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;                              // opens system folder picker
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;                 // opens confirm dialog (parent owns it)
  totalClipCount: number;
  busyAdding?: boolean;
  busyProgress?: { done: number; total: number } | null;
}

export function FolderSidebar({
  folders,
  activeFolderId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  totalClipCount,
  busyAdding = false,
  busyProgress = null,
}: FolderSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [query, setQuery] = useState("");

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    await onRename(id, editName.trim());
    setEditingId(null);
  }

  return (
    <aside className="w-56 shrink-0 border-r border-border h-full overflow-y-auto flex flex-col">
      <div className="p-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
        Library
      </div>

      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-accent ${activeFolderId === null ? "bg-accent font-medium" : ""}`}
      >
        <Library className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">All clips</span>
        <span className="text-xs text-muted-foreground">{totalClipCount}</span>
      </button>

      <div className="px-3 pt-2 pb-1 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground mt-2">
        <span>Folders</span>
      </div>
      <div className="px-2 pb-1">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search folders"
            className="h-7 text-sm pl-7"
          />
        </div>
      </div>

      {filteredFolders.length === 0 && query ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No folders match &ldquo;{query}&rdquo;</div>
      ) : null}

      {filteredFolders.map((f) => (
        <div key={f.id} className="group relative">
          {editingId === f.id ? (
            <div className="px-2 py-1 flex gap-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(f.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                autoFocus
                className="h-7 text-sm"
              />
              <Button size="sm" variant="ghost" onClick={() => handleRename(f.id)} className="h-7 px-2">
                ✓
              </Button>
            </div>
          ) : (
            <button
              onClick={() => onSelect(f.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-accent ${activeFolderId === f.id ? "bg-accent font-medium" : ""}`}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.clipCount}</span>
            </button>
          )}
          <div className="absolute right-2 top-1.5 hidden group-hover:flex gap-1">
            <button
              onClick={() => {
                setEditingId(f.id);
                setEditName(f.name);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Rename folder"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => onDelete(f.id)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete folder"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}

      <div className="p-2 mt-auto border-t border-border space-y-2">
        {busyAdding && busyProgress ? (
          <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>
              Loading {busyProgress.done}/{busyProgress.total}
            </span>
          </div>
        ) : null}
        <Button variant="ghost" size="sm" className="w-full" onClick={onAdd} disabled={busyAdding}>
          <Plus className="w-4 h-4 mr-1" /> Add Folder
        </Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: pass (component is not yet wired up; old tests if any won't be touched).

- [ ] **Step 3: Commit**

```bash
git add src/components/broll/folder-sidebar.tsx
git commit -m "refactor(folder-sidebar): replace inline create with onAdd callback"
```

---

## Task 18: Library panel — wire sidebar + filter grid + addFolder flow

**Files:**
- Modify: `src/components/editor/library/library-panel.tsx`

- [ ] **Step 1: Implement orchestration**

Replace entire contents of `src/components/editor/library/library-panel.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { filterClipsByQuery } from "@/lib/clip-filter";
import { useMediaPool } from "@/state/media-pool";
import { ClipGrid } from "@/components/broll/clip-grid";
import { FolderSidebar, type Folder } from "@/components/broll/folder-sidebar";
import { InvalidFilesDialog, type SkippedItem } from "@/components/broll/invalid-files-dialog";
import {
  DuplicateFolderDialog,
  type DuplicateAction,
} from "@/components/broll/duplicate-folder-dialog";
import { DeleteFolderDialog } from "@/components/broll/delete-folder-dialog";
import { resolveCollidingFolderName } from "@/lib/folder-name-collision";
import { pickFolder } from "@/lib/folder-import";
import { useBuildState } from "@/components/build/build-state-context";
import { toast } from "sonner";

interface PendingFolder {
  pickedName: string;
  files: File[];
  existingFolderId: string;
  existingClipCount: number;
  proposedNewName: string;
}

interface InvalidDialogState {
  folderName: string;
  added: number;
  skipped: SkippedItem[];
}

interface DeleteDialogState {
  bulk: boolean;
  folderId?: string;
  folderName: string;
  clipCount: number;
  usedCount: number;
  audioCount?: number;
  folderCount?: number;
}

export function LibraryPanel() {
  const mediaPool = useMediaPool();
  const buildState = useBuildState();
  const [fileQuery, setFileQuery] = useState("");
  const [busyAdding, setBusyAdding] = useState(false);
  const [busyProgress, setBusyProgress] = useState<{ done: number; total: number } | null>(null);

  const [duplicateDialog, setDuplicateDialog] = useState<PendingFolder | null>(null);
  const [invalidDialog, setInvalidDialog] = useState<InvalidDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);

  const folders: Folder[] = useMemo(
    () =>
      mediaPool.folders.map((f) => ({
        id: f.id,
        name: f.name,
        clipCount: mediaPool.videos.filter((v) => v.folderId === f.id).length,
      })),
    [mediaPool.folders, mediaPool.videos],
  );

  const visibleClips = useMemo(() => {
    const base = mediaPool.activeFolderId
      ? mediaPool.videos.filter((v) => v.folderId === mediaPool.activeFolderId)
      : mediaPool.videos;
    return filterClipsByQuery(base, fileQuery);
  }, [mediaPool.videos, mediaPool.activeFolderId, fileQuery]);

  async function processAdd(name: string, files: File[], options?: { mergeIntoFolderId?: string }) {
    setBusyAdding(true);
    setBusyProgress({ done: 0, total: files.length });
    try {
      const result = await mediaPool.addFolder(name, files, options);
      if (result.skipped.length > 0) {
        setInvalidDialog({ folderName: name, added: result.added, skipped: result.skipped });
      } else if (result.added > 0) {
        toast.success(`Added ${result.added} ${result.added === 1 ? "clip" : "clips"} to "${name}"`);
      }
      mediaPool.setActiveFolderId(result.folderId);
    } finally {
      setBusyAdding(false);
      setBusyProgress(null);
    }
  }

  async function handleAdd() {
    let picked: { videos: File[]; audios: File[]; folderName: string };
    try {
      picked = await pickFolderWithName();
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error(err.message);
      }
      return;
    }

    if (picked.videos.length === 0) {
      toast.error("No video files found in the selected folder");
      return;
    }

    const existing = mediaPool.folders.find((f) => f.name === picked.folderName);
    if (existing) {
      const existingClipCount = mediaPool.videos.filter((v) => v.folderId === existing.id).length;
      const proposedNewName = resolveCollidingFolderName(
        picked.folderName,
        mediaPool.folders.map((f) => f.name),
      );
      setDuplicateDialog({
        pickedName: picked.folderName,
        files: picked.videos,
        existingFolderId: existing.id,
        existingClipCount,
        proposedNewName,
      });
      return;
    }

    await processAdd(picked.folderName, picked.videos);
  }

  function handleDuplicateChoice(action: DuplicateAction) {
    if (!duplicateDialog) return;
    const pending = duplicateDialog;
    setDuplicateDialog(null);
    if (action === "merge") {
      void processAdd(pending.pickedName, pending.files, {
        mergeIntoFolderId: pending.existingFolderId,
      });
    } else {
      void processAdd(pending.proposedNewName, pending.files);
    }
  }

  function handleDeleteRequest(folderId: string) {
    const folder = mediaPool.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const folderClipIds = mediaPool.videos.filter((v) => v.folderId === folderId).map((v) => v.id);
    const usedCount = buildState.countOverlaysUsingClips(folderClipIds);
    setDeleteDialog({
      bulk: false,
      folderId,
      folderName: folder.name,
      clipCount: folderClipIds.length,
      usedCount,
    });
  }

  async function confirmDelete() {
    if (!deleteDialog) return;
    const dlg = deleteDialog;
    setDeleteDialog(null);
    if (dlg.bulk) {
      const allClipIds = mediaPool.videos.map((v) => v.id);
      buildState.removeOverlaysReferencingClips(allClipIds);
      await mediaPool.reset();
      buildState.setAudio(null, null);
    } else if (dlg.folderId) {
      const folderClipIds = mediaPool.videos
        .filter((v) => v.folderId === dlg.folderId)
        .map((v) => v.id);
      buildState.removeOverlaysReferencingClips(folderClipIds);
      await mediaPool.removeFolder(dlg.folderId);
    }
  }

  return (
    <div className="h-full flex overflow-hidden">
      <FolderSidebar
        folders={folders}
        activeFolderId={mediaPool.activeFolderId}
        onSelect={mediaPool.setActiveFolderId}
        onAdd={handleAdd}
        onRename={mediaPool.renameFolder}
        onDelete={handleDeleteRequest}
        totalClipCount={mediaPool.videos.length}
        busyAdding={busyAdding}
        busyProgress={busyProgress}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
          <span className="font-medium">Clips</span>
          <span className="ml-auto text-muted-foreground">{visibleClips.length}</span>
        </div>
        <main className="flex-1 overflow-y-auto p-3 min-w-0">
          {mediaPool.folders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
              <p>No clips loaded yet.</p>
              <p>Click <span className="font-medium">+ Add Folder</span> to upload your first folder.</p>
            </div>
          ) : (
            <ClipGrid
              clips={visibleClips}
              fileQuery={fileQuery}
              onFileQueryChange={setFileQuery}
            />
          )}
        </main>
      </div>

      {duplicateDialog ? (
        <DuplicateFolderDialog
          open
          onOpenChange={(o) => !o && setDuplicateDialog(null)}
          existingFolderName={duplicateDialog.pickedName}
          existingClipCount={duplicateDialog.existingClipCount}
          proposedNewName={duplicateDialog.proposedNewName}
          onChoose={handleDuplicateChoice}
        />
      ) : null}

      {invalidDialog ? (
        <InvalidFilesDialog
          open
          onOpenChange={(o) => !o && setInvalidDialog(null)}
          folderName={invalidDialog.folderName}
          added={invalidDialog.added}
          skipped={invalidDialog.skipped}
        />
      ) : null}

      {deleteDialog ? (
        <DeleteFolderDialog
          open
          onOpenChange={(o) => !o && setDeleteDialog(null)}
          folderName={deleteDialog.folderName}
          clipCount={deleteDialog.clipCount}
          usedCount={deleteDialog.usedCount}
          onConfirm={confirmDelete}
          bulk={deleteDialog.bulk}
          folderCount={deleteDialog.folderCount}
          audioCount={deleteDialog.audioCount}
        />
      ) : null}
    </div>
  );
}

async function pickFolderWithName(): Promise<{ videos: File[]; audios: File[]; folderName: string }> {
  if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
    throw new Error("showDirectoryPicker not supported (Chrome/Edge required)");
  }
  // @ts-expect-error showDirectoryPicker is missing from lib.dom on some TS versions
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
  const folderName = handle.name;
  const { videos, audios } = await pickFolderFromHandle(handle);
  return { videos, audios, folderName };
}

async function pickFolderFromHandle(
  handle: FileSystemDirectoryHandle,
): Promise<{ videos: File[]; audios: File[] }> {
  const { walkDirectoryHandle, categorizeFiles } = await import("@/lib/folder-import");
  const all: File[] = [];
  for await (const file of walkDirectoryHandle(handle)) all.push(file);
  return categorizeFiles(all);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/library/library-panel.tsx
git commit -m "feat(library-panel): wire sidebar + filtered grid + folder upload flow"
```

---

## Task 19: EditorShell — replace back-to-picker with Clear All

**Files:**
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Replace RotateCcw button with Clear All trigger**

Edit `src/components/editor/editor-shell.tsx`:

Add imports at top alongside the existing imports:

```tsx
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useMediaPool } from "@/state/media-pool";
import { DeleteFolderDialog } from "@/components/broll/delete-folder-dialog";
```

Remove `RotateCcw` from imports (no longer used).

Inside `EditorShell`, after the `useBuildState()` destructure block, add:

```tsx
const mediaPool = useMediaPool();
const [clearAllOpen, setClearAllOpen] = useState(false);
```

In the header, replace:

```tsx
<button
  type="button"
  onClick={() => window.location.reload()}
  className="text-muted-foreground hover:text-foreground"
  aria-label="Back to folder picker"
  title="Back to folder picker"
>
  <RotateCcw className="w-4 h-4" />
</button>
```

with:

```tsx
<button
  type="button"
  onClick={() => setClearAllOpen(true)}
  className="text-muted-foreground hover:text-destructive"
  aria-label="Clear all"
  title="Clear all (delete all folders + audio)"
  disabled={mediaPool.folders.length === 0 && !buildStateAudioFile()}
>
  <Trash2 className="w-4 h-4" />
</button>
```

Wait — we need access to `audioFile` here. Just replace `buildStateAudioFile()` with `useBuildState().audioFile`. To avoid duplicate hook call, destructure `audioFile` from the existing `useBuildState()` block at the top:

Find:
```tsx
const {
  audioDialogOpen,
  setAudioDialogOpen,
  ...
  selectedOverlayId,
} = useBuildState();
```

Add `audioFile` and `setAudio`, `removeOverlaysReferencingClips`, `countOverlaysUsingClips` to the destructure list:

```tsx
const {
  audioDialogOpen,
  setAudioDialogOpen,
  scriptDialogOpen,
  setScriptDialogOpen,
  exportDialogOpen,
  setExportDialogOpen,
  previewClipKey,
  setPreviewClipKey,
  inspectorMode,
  selectedOverlayId,
  audioFile,
  setAudio,
  countOverlaysUsingClips,
  removeOverlaysReferencingClips,
} = useBuildState();
```

Then update the disabled prop:
```tsx
disabled={mediaPool.folders.length === 0 && !audioFile}
```

At the bottom, before the closing `</div></OverlayDragProvider>`, add the dialog:

```tsx
{clearAllOpen ? (() => {
  const allClipIds = mediaPool.videos.map((v) => v.id);
  const usedCount = countOverlaysUsingClips(allClipIds);
  return (
    <DeleteFolderDialog
      open
      onOpenChange={setClearAllOpen}
      bulk
      folderName="all folders"
      folderCount={mediaPool.folders.length}
      clipCount={mediaPool.videos.length}
      audioCount={audioFile ? 1 : 0}
      usedCount={usedCount}
      onConfirm={async () => {
        removeOverlaysReferencingClips(allClipIds);
        await mediaPool.reset();
        setAudio(null, null);
        setClearAllOpen(false);
      }}
    />
  );
})() : null}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/editor-shell.tsx
git commit -m "feat(editor-shell): replace back button with Clear All confirm"
```

---

## Task 20: Render EditorShell directly + delete folder-picker

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/components/folder-picker.tsx`
- Delete: `src/components/__tests__/folder-picker.test.tsx`

- [ ] **Step 1: Simplify page.tsx**

Replace entire contents of `src/app/page.tsx`:

```tsx
"use client";

import { EditorShell } from "@/components/editor/editor-shell";

export default function Home() {
  return <EditorShell />;
}
```

- [ ] **Step 2: Delete folder-picker files**

```bash
rm src/components/folder-picker.tsx src/components/__tests__/folder-picker.test.tsx
```

- [ ] **Step 3: Run full check**

Run: `pnpm check && pnpm test`
Expected: lint, typecheck, tests all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/folder-picker.tsx src/components/__tests__/folder-picker.test.tsx
git commit -m "feat(app): render EditorShell directly; remove landing folder picker"
```

---

## Task 21: Manual smoke test + dev server check

**Files:** none

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`
Open: http://localhost:3000

- [ ] **Step 2: Verify empty state**

Expected: editor opens directly with sidebar showing "All clips (0)" + "+ Add Folder" button. Main area shows "No clips loaded yet. Click + Add Folder to upload your first folder."

- [ ] **Step 3: Add a folder with valid B-rolls**

Click "+ Add Folder" → pick a folder containing 2+ files matching `tag-NN.mp4` pattern.

Expected:
- Sidebar shows new folder with clip count
- Folder is auto-selected (highlighted)
- Grid shows clips grouped by base name
- Toast confirms "Added N clips to ..."

- [ ] **Step 4: Add a folder with mix of valid + invalid**

Pick a folder containing some valid + some invalid filenames (e.g., `Hook 1.mp4`, `notes.txt`, `valid-01.mp4`).

Expected: InvalidFilesDialog appears listing each skipped file with its reason. Sidebar shows the folder with only valid clips counted.

- [ ] **Step 5: Add duplicate-named folder**

Pick a different folder on disk that has the same directory name as an existing folder.

Expected: DuplicateFolderDialog appears. Test both branches (Add as new → suffixed name; Merge → clips merge, duplicate broll names skipped).

- [ ] **Step 6: Rename a folder**

Hover folder → click Pencil → type new name → Enter.

Expected: name updates immediately and persists across refresh.

- [ ] **Step 7: Delete a folder (no overlays)**

Click Trash on a folder. Expected: dialog without warning. Confirm → folder gone.

- [ ] **Step 8: Delete a folder with overlays in use**

Drag a clip from folder X into the timeline. Click Trash on folder X.

Expected: dialog shows amber warning "1 overlay in your timeline uses clips from this folder. They will be removed." Confirm → overlay removed + folder gone.

- [ ] **Step 9: Refresh test**

After uploading folders + audio: refresh the page.

Expected: folders, clips, and audio all restored. Clips playable in preview.

- [ ] **Step 10: Clear All test**

Click Clear All button (top header). Expected: bulk dialog with total counts. Confirm → empty state restored.

- [ ] **Step 11: Final commit if any docs/cleanup needed (otherwise skip)**

If changes were needed during smoke test, fix and commit. Otherwise no commit.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Skip landing page → Task 20
- ✅ Upload folders from inside editor → Task 18 (handleAdd)
- ✅ Sidebar with folders, rename, delete → Tasks 17, 18
- ✅ Click folder → grid filters → Task 18 (visibleClips memo)
- ✅ Tag matching unchanged → no change to auto-match.ts core (only `productId` removed)
- ✅ Persist to IDB → Tasks 2-4 (storage), 9-13 (consumers)
- ✅ Empty state with sidebar visible + main empty message → Task 18
- ✅ Invalid files dialog with detailed reasons → Tasks 5, 14, 18
- ✅ Duplicate folder name handling → Tasks 6, 15, 18
- ✅ Delete confirm with overlay warning → Tasks 12, 16, 18
- ✅ Clear all in header → Task 19
- ✅ Hydrated flag → Task 9
- ⚠ Spec mentions `addAudio` / `removeAudio` on MediaPool but actual audio lives in BuildStateContext. Plan handles this in Task 13 (BuildState persistence). The MediaPool API in the spec was wrong about audio location; this plan corrects it. (Documented here in case spec is read separately.)

**Placeholder scan:** None.

**Type consistency:** `FolderEntry` defined in MediaPool, `FolderRecord` in media-storage (transport). Conversion happens at boundaries (Task 9 hydration, Task 10 addFolder). `SkippedReason` extended in Task 10 to include `"failed to read video metadata"`.

**Risk notes:**
- `MediaPool` opens/closes IDB connection per call (in `media-storage.ts`). Acceptable for v1; could cache in v2.
- `JSDOM` env not configured for tests; component-level rendering is not tested. Coverage relies on logic helpers + manual smoke test (Task 21).
- `pickFolderWithName` duplicates some logic from `pickFolder`. Acceptable since `pickFolder` is no longer the only entry point. If both stay, consider consolidating in a follow-up.
