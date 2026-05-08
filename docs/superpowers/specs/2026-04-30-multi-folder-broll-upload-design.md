# Multi-Folder B-roll Upload — Design

**Status:** Approved
**Date:** 2026-04-30

## Problem

Current flow forces user to pick a single folder containing all B-rolls + audio on a landing page before reaching the editor. This is rigid:

- Cannot add B-roll folders incrementally — must repick everything to add new clips.
- Cannot organize clips into separate categories (hook, before-after, benefit, etc.) within the editor.
- Refreshing the page wipes everything; user must re-pick folder every session.
- Landing page adds a friction step before the actual work.

## Goals

1. Skip landing page — editor is the entry point.
2. Upload B-roll **folders** (not individual files) from inside the editor.
3. Each uploaded folder becomes an entry in a sidebar; user can rename and delete folders.
4. Click a folder → main grid filters to that folder's clips. "All clips" shows everything.
5. Folders are organizational only; broll-name → tag matching logic stays exactly as-is (`tag-NN.mp4` pattern, `deriveBaseName`).
6. Persist everything (folders + clip metadata + file binaries + audio) to IndexedDB. Refresh restores the project.

## Non-Goals

- No cloud sync / multi-device.
- No per-folder color/icon customization.
- Audio handling stays as it is (set via toolbar pill, separate from folder upload). Folder uploads only ingest video files.
- No editing of broll names from the UI — user renames files on disk and re-uploads.

## User Flow

### Empty state (first visit, IDB empty)
1. App opens directly into the editor (no landing page).
2. Library panel sidebar shows: "All clips (0)" + "+ Add Folder" button.
3. Main grid shows: "No clips loaded yet. Click + Add Folder to upload your first folder."

### Adding a folder
1. Click "+ Add Folder" → browser folder picker.
2. App walks folder, categorizes files into videos / audios.
3. Audios silently ignored (out of scope).
4. Videos validated against `tag-NN.mp4` pattern.
5. If picked folder name duplicates an existing folder → DuplicateFolderDialog (Add as new / Merge / Cancel).
6. Valid videos written to IDB (folder + clips + file blobs in one transaction).
7. New folder auto-selected in sidebar.
8. If any files were skipped → InvalidFilesDialog lists them with reasons.

### Browsing
- Click folder → grid filters to that folder.
- Click "All clips" → grid shows all clips across folders, grouped by `deriveBaseName` (existing behavior).
- Search bar filters within the current view.

### Renaming a folder
- Hover folder → click Pencil → inline input → Enter to save (existing FolderSidebar behavior).

### Deleting a folder
- Hover folder → click Trash → DeleteFolderDialog (confirms with clip count + warning if any clips are in use in timeline overlays).
- On confirm: overlays referencing this folder's clips are removed from build state, then folder + clips + files are removed from IDB + memory + URL cache.

### Reset / Clear all
- Header Reset button (replaces "Back to folder picker") opens DeleteFolderDialog in bulk-mode: "Delete all 4 folders, 28 clips, and 1 audio?"

### Refresh
- App reloads → MediaPool hydrates from IDB before EditorShell renders main UI (uses `hydrated` flag to gate against flash of empty state).
- Files reconstructed from stored Blobs, fileMap re-populated, object URLs created lazily on demand (existing pattern).

## Architecture

### Routing
- `src/app/page.tsx` — render `<EditorShell />` directly. Drop the `loaded` flag and FolderPicker.
- Delete `src/components/folder-picker.tsx`.

### Data model

```ts
// src/state/media-pool.tsx
interface FolderEntry {
  id: string;          // crypto.randomUUID()
  name: string;        // editable; default = picked folder's directory name
  createdAt: Date;
}

// ClipMetadata (src/lib/auto-match.ts) change:
// - folderId: was hardcoded "local", now real folder ID
// - productId: dead field, evaluate during planning whether to remove
```

### IndexedDB schema (`src/lib/media-storage.ts`, IDB v1)

| Store | keyPath | Value | Indexes |
|---|---|---|---|
| `folders` | `id` | `FolderEntry` | (none) |
| `clips` | `id` | `ClipMetadata` | `folderId` |
| `files` | `id` | `{ id, blob, type, filename }` | (none) |
| `audios` | `id` | `{ id, filename, blob, type }` | (none) |
| `meta` | `key` | misc state e.g. `selectedAudioId` | (none) |

**Atomicity:** `addFolder` writes folder + N clips + N files in a single `readwrite` transaction across `folders + clips + files`. `removeFolder` deletes in a single transaction across the same stores.

**File reconstruction on load:** `new File([blob], filename, { type })`.

### MediaPool API

```ts
interface MediaPool {
  // existing
  videos: ClipMetadata[];
  audios: AudioFileEntry[];
  fileMap: Map<string, File>;
  selectedAudioId: string | null;
  selectAudio: (id: string | null) => void;
  getFileURL: (fileId: string) => string | null;
  getFile: (fileId: string) => File | null;

  // new
  folders: FolderEntry[];
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  addFolder: (name: string, files: File[], options?: { mergeIntoFolderId?: string }) => Promise<AddFolderResult>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  addAudio: (file: File) => Promise<void>;
  removeAudio: (id: string) => Promise<void>;
  reset: () => Promise<void>;          // wipes IDB + memory
  hydrated: boolean;
}

interface AddFolderResult {
  folderId: string;
  added: number;
  skipped: { filename: string; reason: SkippedReason }[];
}

type SkippedReason =
  | "not a video file"
  | "must be lowercase, no spaces"
  | "must end with -NN"
  | "must match tag-NN pattern"
  | "broll name already exists in this folder"; // merge mode only

// setMedia removed — bulk replace no longer needed
```

### Build-state cleanup on folder delete

Build-state context exposes:
```ts
countOverlaysUsingClips(clipIds: string[]): number;
removeOverlaysReferencingClips(clipIds: string[]): number;
```

FolderSidebar's onDelete handler calls `count` → opens dialog → on confirm, calls `removeOverlaysReferencingClips` then `mediaPool.removeFolder`.

### Library panel layout

```
LibraryPanel
├─ <FolderSidebar> (existing component, wired to MediaPool)
│    ├─ "All clips" item (sets activeFolderId = null)
│    ├─ folders list (rename/delete actions)
│    └─ "+ Add Folder" button
└─ <ClipGrid> (filtered by activeFolderId; existing baseName grouping preserved)
     └─ search bar (filters within current view)
```

Sidebar progress UI: while `addFolder` runs, show inline indicator "Loading X / Y" under the sidebar header.

### New components

| Component | File | Purpose |
|---|---|---|
| `InvalidFilesDialog` | `src/components/broll/invalid-files-dialog.tsx` | List skipped files grouped by reason; Got it button |
| `DuplicateFolderDialog` | `src/components/broll/duplicate-folder-dialog.tsx` | Radio: Add as new / Merge; returns chosen action |
| `DeleteFolderDialog` | `src/components/broll/delete-folder-dialog.tsx` | AlertDialog with two variants based on `usedCount`; destructive button |

All use shadcn `Dialog` / `AlertDialog` primitives consistent with existing AudioDialog / ScriptDialog.

### Header changes

`EditorShell` toolbar (left side):
- Replace "Back to folder picker" RotateCcw button with "Clear all" button → opens DeleteFolderDialog in bulk mode.

## Validation rules — `validateBrollFile(file)`

Returns `{ valid: true; brollName: string } | { valid: false; reason: SkippedReason }`.

| Check (in order) | Reason if fails |
|---|---|
| Extension in `.mp4 / .mov / .webm` | `"not a video file"` |
| No uppercase, no whitespace in filename stem | `"must be lowercase, no spaces"` |
| Stem matches `^[a-z0-9-]+-\d+$` | `"must end with -NN"` |
| (catch-all if regex fails for other reason) | `"must match tag-NN pattern"` |

Note: extension-less filenames or non-video extensions hit "not a video file" first.

## Persistence semantics

- All mutations write IDB **before** updating React state, so a refresh during an operation either sees the pre-state or the post-state — never partial.
- Object URLs created lazily on `getFileURL`, cached in MediaPool. On `removeFolder`, URLs for that folder's clips are revoked individually.
- Storage quota: not enforced in v1; if browser quota exceeded, `addFolder` throws and surfaces error toast (no partial folder).

## Out of scope (v1)

- Drag-and-drop folder upload (only via "+ Add Folder" button).
- Bulk multi-folder selection in sidebar (only single active folder filter).
- Reordering folders in sidebar (insertion order preserved by `createdAt`).
- Search across folders (search bar still scoped to current view).
- Per-clip move-to-other-folder (would require UI for picking target).

## Testing

### Unit
1. `media-storage.test.ts` (new) — IDB CRUD round-trips, transaction atomicity, cascading delete. Use `fake-indexeddb` (verify dependency exists during planning; add if missing).
2. `broll.test.ts` (extend existing) — `validateBrollFile` reason taxonomy.
3. `media-pool.test.tsx` (new) — provider behavior: addFolder hydrates state + writes IDB, removeFolder revokes URLs, hydrated flag transitions, duplicate folder name detection.

### Component
4. `folder-sidebar.test.tsx` (extend or new) — Add/select/rename/delete actions wire correctly.
5. `invalid-files-dialog.test.tsx` (new) — renders skipped list grouped by reason.
6. `duplicate-folder-dialog.test.tsx` (new) — radio choice → returns correct action; cancel returns null.
7. `delete-folder-dialog.test.tsx` (new) — variant A vs B selected by `usedCount`.

### Integration
8. `library-panel.integration.test.tsx` (new) — mock `pickFolder()` with fixture files; full flow: add folder, switch active folder, delete folder.

### Manual (post-implementation)
- Browser FS API folder picker with real mp4 files (Playwright cannot drive `showDirectoryPicker()`).
- Refresh persistence end-to-end: upload → refresh → folder restored, clips playable.
- Quota behavior with a deliberately huge folder.
