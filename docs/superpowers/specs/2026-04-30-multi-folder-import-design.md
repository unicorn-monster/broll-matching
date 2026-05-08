# Multi-Folder Import — Design Spec

**Date:** 2026-04-30
**Branch:** feat/srt-style-script-format
**Status:** Approved

## Problem

`showDirectoryPicker()` picks exactly one directory per call. Users must click "Add Folder" N times to import N folders, which is slow for large libraries.

## Goal

Let users import multiple folders in a single action — either via the native Finder picker (Cmd+A) or by dragging multiple folders from Finder into the panel.

## Approach

Two complementary entry points, both funneling into the same multi-folder processing pipeline:

1. **Button picker** — replace `showDirectoryPicker()` with `<input type="file" webkitdirectory multiple>`. Chrome on macOS opens NSOpenPanel with multi-select enabled.
2. **Drag & drop** — full-panel overlay on `FoldersGrid` accepts multiple `FileSystemDirectoryEntry` objects from `dataTransfer.items`.

## Architecture

### LibraryPanel (owner of all logic)

New hidden input element:
```tsx
<input ref={inputRef} type="file" /* webkitdirectory multiple */ className="hidden" onChange={handleInputChange} />
```
(TypeScript requires the non-standard attributes as `{...{ webkitdirectory: "", multiple: true }}`.)

**`handleAdd()`** — changed from calling `pickFolderWithName()` to `inputRef.current?.click()`.

**`handleInputChange(e)`** — groups `e.target.files` by `file.webkitRelativePath.split('/')[0]`, then:
- 1 folder → existing single-folder flow (duplicate dialog shown if name collision)
- 2+ folders → `handleMultipleFolders()`

**`handleDropFolders(entries: FileSystemDirectoryEntry[])`** — walks each entry via `walkDirectoryEntry()`, builds `{name, files}[]`, calls `handleMultipleFolders()`.

**`handleMultipleFolders(folders: {name: string, files: File[]}[])`**:
1. For each folder:
   - Filter videos via `categorizeFiles()`
   - Check name collision → auto-rename with `resolveCollidingFolderName()`
   - Call `mediaPool.addFolder()` directly (no duplicate dialog)
   - Collect `{added, skipped, renamed}` stats
2. Update progress: `busyProgress = { done: i, total: folders.length }` (folder-level, not file-level)
3. After all done: single summary toast `"3 folders added · 1 auto-renamed · 8 files skipped"` (omit zero-value segments)

**Duplicate dialog** — retained for the single-folder-via-button path only. Not shown during multi-folder or drag-and-drop flows.

### FoldersGrid (UI only, no logic)

New prop: `onDropFolders: (entries: FileSystemDirectoryEntry[]) => void`

Internal drag state: `isDraggingOver: boolean`

Drag event handlers on the root container:
- `dragenter` — if any item is a directory entry → `setIsDraggingOver(true)`, `e.preventDefault()`
- `dragover` — `e.preventDefault()` (required for drop to fire)
- `dragleave` — guard with `relatedTarget` to avoid flicker on child elements → `setIsDraggingOver(false)`
- `drop` — collect `FileSystemDirectoryEntry[]` from `e.dataTransfer.items`, call `onDropFolders`, clear drag state

Overlay (rendered when `isDraggingOver`):
```
absolute inset-0 z-20 flex flex-col items-center justify-center
bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-md
```
Content: large folder icon + "Drop folders here" text.

### folder-import.ts

New export `walkDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]>` — uses the older `FileSystemDirectoryReader` API (from `DataTransfer`, not File System Access API) to recursively collect files.

```ts
export async function walkDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];
  const reader = entry.createReader();
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    for (const e of batch) {
      if (e.isFile) {
        files.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
      } else if (e.isDirectory) {
        files.push(...await walkDirectoryEntry(e as FileSystemDirectoryEntry));
      }
    }
  } while (batch.length > 0);
  return files;
}
```

Note: `readEntries` returns at most 100 entries per call; the `do/while` loop handles directories with >100 items.

New export `groupFilesByFolder(files: FileList | File[]): Map<string, File[]>` — groups by `file.webkitRelativePath.split('/')[0]`.

## Progress Display

`busyProgress` changes meaning for multi-folder:
- `done`: folders completed so far
- `total`: total folders being imported

Button label: `"Adding 2/5 folders…"` (existing `busyProgress.done/total` display already handles this).

## Error Handling

- Empty folder (no videos after filter) → skipped silently, counted in toast
- `walkDirectoryEntry` failure → log to console, skip that folder, count as skipped
- All folders fail → toast error `"No video files found in selected folders"`

## Files Changed

| File | Change |
|------|--------|
| `src/lib/folder-import.ts` | Add `walkDirectoryEntry`, `groupFilesByFolder` |
| `src/components/editor/library/folders-grid.tsx` | Add `onDropFolders` prop, drag state, overlay |
| `src/components/editor/library/library-panel.tsx` | Replace `pickFolderWithName`, add `handleInputChange`, `handleDropFolders`, `handleMultipleFolders`, hidden input |

## Out of Scope

- Drag & drop into the clips view (only folders view)
- Progress per individual file during multi-folder import
- Undo/rollback if one folder in a batch fails
