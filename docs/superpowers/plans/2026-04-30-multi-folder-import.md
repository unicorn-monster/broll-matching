# Multi-Folder Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import multiple folders at once via a native Finder picker (Cmd+A) or by dragging multiple folders into the library panel.

**Architecture:** Replace `showDirectoryPicker()` with a hidden `<input type="file" webkitdirectory multiple>` that Chrome maps to a native multi-select directory picker. Add a drag-and-drop overlay to `FoldersGrid` that accepts multiple `FileSystemDirectoryEntry` objects. Both paths funnel into a shared `handleMultipleFolders()` in `LibraryPanel`. Single-folder picks keep the existing duplicate-name dialog; multi-folder picks auto-rename.

**Tech Stack:** Next.js App Router, React, TypeScript, vitest, Tailwind CSS, sonner (toasts)

---

## File Map

| File | What changes |
|------|-------------|
| `src/lib/folder-import.ts` | Add `walkDirectoryEntry`, `groupFilesByFolder`; remove unused `pickFolder` |
| `src/lib/__tests__/folder-import.test.ts` | Add tests for both new utilities |
| `src/components/editor/library/folders-grid.tsx` | Add `onDropFolders` prop, drag state, overlay |
| `src/components/editor/library/library-panel.tsx` | Add hidden input, replace `pickFolderWithName`, add `handleInputChange` / `handleDropFolders` / `handleMultipleFolders` |

---

## Task 1: Add `groupFilesByFolder` to `folder-import.ts` (TDD)

**Files:**
- Modify: `src/lib/__tests__/folder-import.test.ts`
- Modify: `src/lib/folder-import.ts`

- [ ] **Step 1.1 — Write failing tests for `groupFilesByFolder`**

Append to `src/lib/__tests__/folder-import.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { categorizeFiles, walkDirectoryHandle, groupFilesByFolder } from "../folder-import";

// ... existing tests unchanged above ...

describe("groupFilesByFolder", () => {
  function makeRelFile(relPath: string): File {
    const f = new File(["x"], relPath.split("/").at(-1)!, { type: "" });
    Object.defineProperty(f, "webkitRelativePath", { value: relPath });
    return f;
  }

  it("groups files by top-level folder name from webkitRelativePath", () => {
    const files = [
      makeRelFile("authority/clip-01.mp4"),
      makeRelFile("authority/clip-02.mp4"),
      makeRelFile("benefit/b-01.mp4"),
    ];
    const grouped = groupFilesByFolder(files);
    expect(grouped.size).toBe(2);
    expect(grouped.get("authority")!.length).toBe(2);
    expect(grouped.get("benefit")!.length).toBe(1);
  });

  it("falls back to file.name when webkitRelativePath is empty", () => {
    const f = new File(["x"], "standalone.mp4", { type: "" });
    const grouped = groupFilesByFolder([f]);
    expect(grouped.size).toBe(1);
    expect(grouped.has("standalone.mp4")).toBe(true);
  });

  it("accepts a FileList-like array", () => {
    const files = [
      makeRelFile("hook/h1.mp4"),
      makeRelFile("hook/h2.mp4"),
      makeRelFile("data/d1.mp4"),
    ];
    const grouped = groupFilesByFolder(files);
    expect([...grouped.keys()].sort()).toEqual(["data", "hook"]);
  });
});
```

- [ ] **Step 1.2 — Run tests to confirm they fail**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl && npm test -- --reporter=verbose 2>&1 | grep -A3 "groupFilesByFolder"
```

Expected: `ReferenceError: groupFilesByFolder is not defined` or similar import error.

- [ ] **Step 1.3 — Implement `groupFilesByFolder` in `folder-import.ts`**

Add after the `categorizeFiles` function (before `walkDirectoryHandle`):

```typescript
export function groupFilesByFolder(files: FileList | File[]): Map<string, File[]> {
  const map = new Map<string, File[]>();
  for (const file of Array.from(files)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const key = rel ? rel.split("/")[0] : file.name;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(file);
  }
  return map;
}
```

- [ ] **Step 1.4 — Run tests to confirm they pass**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl && npm test -- --reporter=verbose 2>&1 | grep -A3 "groupFilesByFolder"
```

Expected: all 3 `groupFilesByFolder` tests PASS.

---

## Task 2: Add `walkDirectoryEntry` to `folder-import.ts` (TDD)

**Files:**
- Modify: `src/lib/__tests__/folder-import.test.ts`
- Modify: `src/lib/folder-import.ts`

- [ ] **Step 2.1 — Write failing tests for `walkDirectoryEntry`**

Append to `src/lib/__tests__/folder-import.test.ts`:

```typescript
import { ..., walkDirectoryEntry } from "../folder-import";

// Helper to build a fake FileSystemFileEntry
function fakeFileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(new File(["x"], name, { type: "" })),
  } as unknown as FileSystemFileEntry;
}

// Helper to build a fake FileSystemDirectoryEntry
function fakeDirEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  let done = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
        if (!done) { done = true; cb(children); } else cb([]);
      },
    }),
  } as unknown as FileSystemDirectoryEntry;
}

describe("walkDirectoryEntry", () => {
  it("collects all files from a flat directory", async () => {
    const entry = fakeDirEntry("root", [fakeFileEntry("a.mp4"), fakeFileEntry("b.mp4")]);
    const files = await walkDirectoryEntry(entry);
    expect(files.map((f) => f.name).sort()).toEqual(["a.mp4", "b.mp4"]);
  });

  it("recursively collects files from subdirectories", async () => {
    const entry = fakeDirEntry("root", [
      fakeFileEntry("top.mp4"),
      fakeDirEntry("sub", [fakeFileEntry("deep.mp4")]),
    ]);
    const files = await walkDirectoryEntry(entry);
    expect(files.map((f) => f.name).sort()).toEqual(["deep.mp4", "top.mp4"]);
  });

  it("handles directories with >100 items via batched readEntries", async () => {
    const allChildren: FileSystemFileEntry[] = Array.from({ length: 150 }, (_, i) =>
      fakeFileEntry(`f${i}.mp4`),
    );
    let call = 0;
    const entry = {
      isFile: false,
      isDirectory: true,
      name: "big",
      createReader: () => ({
        readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
          if (call === 0) { call++; cb(allChildren.slice(0, 100)); }
          else if (call === 1) { call++; cb(allChildren.slice(100)); }
          else cb([]);
        },
      }),
    } as unknown as FileSystemDirectoryEntry;
    const files = await walkDirectoryEntry(entry);
    expect(files.length).toBe(150);
  });

  it("returns empty array for an empty directory", async () => {
    const entry = fakeDirEntry("empty", []);
    const files = await walkDirectoryEntry(entry);
    expect(files).toEqual([]);
  });
});
```

- [ ] **Step 2.2 — Run tests to confirm they fail**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl && npm test -- --reporter=verbose 2>&1 | grep -A3 "walkDirectoryEntry"
```

Expected: import error — `walkDirectoryEntry` not exported yet.

- [ ] **Step 2.3 — Implement `walkDirectoryEntry` in `folder-import.ts`**

Add after `walkDirectoryHandle`:

```typescript
export async function walkDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];
  const reader = entry.createReader();
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    for (const e of batch) {
      if (e.isFile) {
        files.push(
          await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)),
        );
      } else if (e.isDirectory) {
        files.push(...(await walkDirectoryEntry(e as FileSystemDirectoryEntry)));
      }
    }
  } while (batch.length > 0);
  return files;
}
```

- [ ] **Step 2.4 — Run full test suite**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl && npm test 2>&1 | tail -20
```

Expected: all tests PASS, no regressions.

- [ ] **Step 2.5 — Remove unused `pickFolder` export from `folder-import.ts`**

Delete the `pickFolder` function at the bottom of `src/lib/folder-import.ts` (lines 37–48). It used `showDirectoryPicker` which is being replaced.

Verify nothing imports `pickFolder`:
```bash
grep -r "pickFolder" /Users/quanghuy/Documents/mix-n-match-vsl/src --include="*.ts" --include="*.tsx"
```
Expected: no results (or only the definition you just deleted).

- [ ] **Step 2.6 — Commit**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl
git add src/lib/folder-import.ts src/lib/__tests__/folder-import.test.ts
git commit -m "feat(folder-import): add walkDirectoryEntry + groupFilesByFolder, remove pickFolder"
```

---

## Task 3: Add drag-and-drop overlay to `FoldersGrid`

**Files:**
- Modify: `src/components/editor/library/folders-grid.tsx`

- [ ] **Step 3.1 — Add `onDropFolders` prop to `FoldersGridProps`**

In `src/components/editor/library/folders-grid.tsx`, update the interface:

```typescript
interface FoldersGridProps {
  folders: FolderTile[];
  totalClipCount: number;
  onSelectAll: () => void;
  onSelectFolder: (folderId: string) => void;
  onAdd: () => void;
  onDropFolders: (entries: FileSystemDirectoryEntry[]) => void;  // NEW
  onRename: (id: string, name: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  busyAdding?: boolean;
  busyProgress?: { done: number; total: number } | null;
}
```

Update the function signature to destructure `onDropFolders`:

```typescript
export function FoldersGrid({
  folders,
  totalClipCount,
  onSelectAll,
  onSelectFolder,
  onAdd,
  onDropFolders,   // NEW
  onRename,
  onDelete,
  busyAdding,
  busyProgress,
}: FoldersGridProps) {
```

- [ ] **Step 3.2 — Add drag state and helper inside `FoldersGrid`**

At the top of `FoldersGrid` body (after `const [query, setQuery] = useState("")`):

```typescript
const [isDraggingOver, setIsDraggingOver] = useState(false);

function getFolderEntries(e: React.DragEvent): FileSystemDirectoryEntry[] {
  const entries: FileSystemDirectoryEntry[] = [];
  for (const item of Array.from(e.dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) entries.push(entry as FileSystemDirectoryEntry);
  }
  return entries;
}
```

- [ ] **Step 3.3 — Wire drag events on the root container**

Replace the root `<div className="h-full flex flex-col overflow-hidden">` opening tag with:

```tsx
<div
  className="h-full flex flex-col overflow-hidden relative"
  onDragEnter={(e) => {
    e.preventDefault();
    if (getFolderEntries(e).length > 0) setIsDraggingOver(true);
  }}
  onDragOver={(e) => {
    e.preventDefault();
  }}
  onDragLeave={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }}
  onDrop={(e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const entries = getFolderEntries(e);
    if (entries.length > 0) onDropFolders(entries);
  }}
>
```

- [ ] **Step 3.4 — Render the drag overlay**

Inside the root div, immediately after the opening tag (before the header div), add:

```tsx
{isDraggingOver && (
  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm border-2 border-dashed border-primary rounded-md pointer-events-none">
    <Folder className="w-12 h-12 fill-primary/20 text-primary" />
    <span className="text-sm font-medium text-primary">Drop folders here</span>
  </div>
)}
```

`Folder` is already imported from `lucide-react`.

- [ ] **Step 3.5 — Manual test: drag overlay appears**

1. `npm run dev`
2. Open the library panel (folders view)
3. Open Finder, select any folder
4. Drag it over the library panel — the overlay "Drop folders here" should appear
5. Drag away — overlay disappears
6. Do NOT drop yet (LibraryPanel handler not wired yet)

- [ ] **Step 3.6 — Commit**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl
git add src/components/editor/library/folders-grid.tsx
git commit -m "feat(folders-grid): add drag-and-drop overlay with onDropFolders prop"
```

---

## Task 4: Wire multi-folder processing in `LibraryPanel`

**Files:**
- Modify: `src/components/editor/library/library-panel.tsx`

- [ ] **Step 4.1 — Update imports at top of `library-panel.tsx`**

Add a new static import for the three utilities from `folder-import` (there is no existing static import of this module — it was previously dynamic-imported inside `pickFolderWithName`):

```typescript
import { walkDirectoryEntry, groupFilesByFolder, categorizeFiles } from "@/lib/folder-import";
```

Add `useRef` to the React import:

```typescript
import { useMemo, useState, useRef } from "react";
```

- [ ] **Step 4.2 — Add hidden file input element**

Inside the `LibraryPanel` component body, add the ref:

```typescript
const inputRef = useRef<HTMLInputElement>(null);
```

At the very end of the JSX return (just before the closing `</div>`), add the hidden input:

```tsx
<input
  ref={inputRef}
  type="file"
  className="hidden"
  onChange={handleInputChange}
  {...{ webkitdirectory: "", multiple: true }}
/>
```

(The `{...{ webkitdirectory: "", multiple: true }}` spread bypasses TypeScript's missing DOM attribute for `webkitdirectory`.)

- [ ] **Step 4.3 — Replace `handleAdd` to trigger the input**

Replace the entire `handleAdd` function with:

```typescript
function handleAdd() {
  inputRef.current?.click();
}
```

- [ ] **Step 4.4 — Add `handleMultipleFolders`**

Add after `processAdd`:

```typescript
async function handleMultipleFolders(folders: { name: string; files: File[] }[]) {
  setBusyAdding(true);
  let totalAdded = 0;
  let totalRenamed = 0;
  let totalSkipped = 0;
  const takenNames = mediaPool.folders.map((f) => f.name);

  for (let i = 0; i < folders.length; i++) {
    setBusyProgress({ done: i, total: folders.length });
    const { name, files } = folders[i];
    const { videos } = categorizeFiles(files);
    if (videos.length === 0) {
      totalSkipped += files.length;
      continue;
    }
    totalSkipped += files.length - videos.length;

    let finalName = name;
    if (takenNames.includes(name)) {
      finalName = resolveCollidingFolderName(name, takenNames);
      totalRenamed++;
    }

    try {
      const result = await mediaPool.addFolder(finalName, videos);
      totalAdded++;
      totalSkipped += result.skipped.length;
      takenNames.push(finalName);
    } catch {
      totalSkipped += videos.length;
    }
  }

  setBusyAdding(false);
  setBusyProgress(null);

  const parts: string[] = [];
  if (totalAdded > 0) parts.push(`${totalAdded} folder${totalAdded === 1 ? "" : "s"} added`);
  if (totalRenamed > 0) parts.push(`${totalRenamed} auto-renamed`);
  if (totalSkipped > 0) parts.push(`${totalSkipped} file${totalSkipped === 1 ? "" : "s"} skipped`);

  if (parts.length > 0) {
    toast.success(parts.join(" · "));
  } else {
    toast.error("No video files found in selected folders");
  }
}
```

- [ ] **Step 4.5 — Add `handleInputChange`**

Add after `handleMultipleFolders`:

```typescript
async function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
  const fileList = e.target.files;
  if (!fileList || fileList.length === 0) return;
  e.target.value = "";

  const grouped = groupFilesByFolder(fileList);
  const folders = Array.from(grouped.entries()).map(([name, files]) => ({ name, files }));

  if (folders.length === 1) {
    const { name, files } = folders[0];
    const { videos } = categorizeFiles(files);
    if (videos.length === 0) {
      toast.error("No video files found in the selected folder");
      return;
    }
    const existing = mediaPool.folders.find((f) => f.name === name);
    if (existing) {
      const existingClipCount = mediaPool.videos.filter((v) => v.folderId === existing.id).length;
      const proposedNewName = resolveCollidingFolderName(
        name,
        mediaPool.folders.map((f) => f.name),
      );
      setDuplicateDialog({
        pickedName: name,
        files: videos,
        existingFolderId: existing.id,
        existingClipCount,
        proposedNewName,
      });
      return;
    }
    await processAdd(name, videos);
  } else {
    await handleMultipleFolders(folders);
  }
}
```

- [ ] **Step 4.6 — Add `handleDropFolders`**

Add after `handleInputChange`:

```typescript
async function handleDropFolders(entries: FileSystemDirectoryEntry[]) {
  const folders: { name: string; files: File[] }[] = [];
  for (const entry of entries) {
    try {
      const files = await walkDirectoryEntry(entry);
      folders.push({ name: entry.name, files });
    } catch {
      // unreadable entry — skip silently
    }
  }
  if (folders.length === 0) return;
  await handleMultipleFolders(folders);
}
```

- [ ] **Step 4.7 — Pass `onDropFolders` to `FoldersGrid`**

In the JSX, add the `onDropFolders` prop to `<FoldersGrid>`:

```tsx
<FoldersGrid
  folders={folderTiles}
  totalClipCount={mediaPool.videos.length}
  onSelectAll={handleSelectAll}
  onSelectFolder={handleSelectFolder}
  onAdd={handleAdd}
  onDropFolders={handleDropFolders}   // NEW
  onRename={mediaPool.renameFolder}
  onDelete={handleDeleteRequest}
  busyAdding={busyAdding}
  busyProgress={busyProgress}
/>
```

- [ ] **Step 4.8 — Delete `pickFolderWithName` function**

Remove the `async function pickFolderWithName()` at the bottom of the file (lines ~266–278). It is no longer called.

- [ ] **Step 4.9 — TypeScript check**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl && npx tsc --noEmit 2>&1
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 4.10 — Run tests**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl && npm test 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4.11 — Commit**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl
git add src/components/editor/library/library-panel.tsx
git commit -m "feat(library-panel): multi-folder import via input picker and drag-and-drop"
```

---

## Task 5: End-to-end manual test

- [ ] **Step 5.1 — Test multi-folder via button**

1. Open the app in Chrome, go to library panel (folders view)
2. Click "Add Folder"
3. In the Finder dialog, Cmd+A or Cmd+click to select 3+ folders with video files
4. Click "Open"
5. Expected: progress "Adding 0/3…" → "Adding 1/3…" → … → toast "3 folders added"
6. All folders appear as tiles in the grid

- [ ] **Step 5.2 — Test auto-rename**

1. Click "Add Folder", pick a folder that already exists in the library (same name)
2. Expected (single folder): duplicate dialog appears asking merge/rename — existing behavior preserved
3. Now test multi-folder: pick 2+ folders where one name already exists
4. Expected: no dialog — toast shows "2 folders added · 1 auto-renamed"
5. The renamed folder appears as "authority (2)" (or similar)

- [ ] **Step 5.3 — Test drag & drop single folder**

1. Open Finder, select ONE folder with video files
2. Drag it onto the library panel
3. Overlay "Drop folders here" appears while dragging
4. Drop — folder is added, toast "1 folder added"

- [ ] **Step 5.4 — Test drag & drop multiple folders**

1. In Finder, Cmd+A to select all folders in a directory
2. Drag them all onto the library panel
3. Expected: overlay appears, on drop: toast "N folders added"

- [ ] **Step 5.5 — Test drag & drop with duplicate**

1. Drag a folder whose name already exists in the library
2. Expected: toast "1 folder added · 1 auto-renamed", no dialog

- [ ] **Step 5.6 — Test dragging non-folder items**

1. Try dragging a video FILE (not a folder) onto the panel
2. Expected: overlay does NOT appear (only directory entries trigger it)

- [ ] **Step 5.7 — Final commit if any fixes needed**

```bash
cd /Users/quanghuy/Documents/mix-n-match-vsl
git add -p
git commit -m "fix(multi-folder-import): <describe fix>"
```
