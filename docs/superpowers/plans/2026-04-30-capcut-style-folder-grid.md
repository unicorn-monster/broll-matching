# CapCut-Style Folder Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-column sidebar+clips layout in `LibraryPanel` with a single-panel CapCut-style folder grid that drills down into a clip view via a Back button.

**Architecture:** Local view state machine (`"folders" | "clips"`) inside `LibraryPanel`. Folders view renders the existing `FoldersGrid` (yellow folder tiles + neutral "All clips" tile, 3-cols). Clips view renders a Back-button header above the existing `ClipGrid` (which already provides clip-name search). Folder selection continues to be tracked via `mediaPool.activeFolderId` (no media-pool changes); only the panel UI changes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS, lucide-react icons, sonner toasts, vitest for lib tests.

**Spec:** [docs/superpowers/specs/2026-04-30-capcut-style-folder-grid-design.md](docs/superpowers/specs/2026-04-30-capcut-style-folder-grid-design.md)

---

## File Structure

| Path | Purpose | Action |
|---|---|---|
| `src/components/editor/library/library-panel.tsx` | Library panel container (currently sidebar + clips) | **Rewrite** to a view-state machine |
| `src/components/editor/library/folders-grid.tsx` | Folder grid component (already implements the visual) | **Modify**: change "All clips" icon from `Layers` to `Folder` (white tone), swap inline `onCreate` for `onAdd` (OS picker), add empty-state hint |
| `src/components/broll/folder-sidebar.tsx` | Old sidebar component | **Leave untouched** — orphan after this change, cleanup is a follow-up |
| `src/state/media-pool.tsx` | Pool state | **Leave untouched** — `activeFolderId` API stays, only consumer changes |

---

## Task 1: Modify `FoldersGrid` API and visuals

**Files:**
- Modify: `src/components/editor/library/folders-grid.tsx`

- [ ] **Step 1: Replace `onCreate` prop with `onAdd` and remove inline-create state**

The existing component has an inline-name-input flow (`creating` / `newName` state, `onCreate(name)` callback). We replace that with a single `onAdd` callback that the parent uses to trigger the OS folder picker.

Edit `src/components/editor/library/folders-grid.tsx` — replace the entire file contents with:

```tsx
"use client";

import { Folder, FolderPlus, MoreVertical, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { filterFoldersByName } from "@/lib/folder-filter";

export interface FolderTile {
  id: string;
  name: string;
  clipCount: number;
}

interface FoldersGridProps {
  folders: FolderTile[];
  totalClipCount: number;
  onSelectAll: () => void;
  onSelectFolder: (folderId: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  busyAdding?: boolean;
  busyProgress?: { done: number; total: number } | null;
}

export function FoldersGrid({
  folders,
  totalClipCount,
  onSelectAll,
  onSelectFolder,
  onAdd,
  onRename,
  onDelete,
  busyAdding,
  busyProgress,
}: FoldersGridProps) {
  const [query, setQuery] = useState("");

  const visibleFolders = filterFoldersByName(folders, query);
  const showEmptyHint = folders.length === 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <span className="font-medium text-muted-foreground uppercase tracking-wide shrink-0">Library</span>
        <div className="relative flex-1 min-w-0">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search folders…"
            aria-label="Search folders"
            className="w-full pl-6 pr-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={busyAdding}
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50 disabled:pointer-events-none"
          aria-label="Add folder"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          {busyAdding && busyProgress
            ? `Adding ${busyProgress.done}/${busyProgress.total}…`
            : "Add Folder"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-3">
          <FolderTileCard
            icon={<Folder className="w-10 h-10 fill-muted text-muted-foreground" />}
            name="All clips"
            count={totalClipCount}
            tone="neutral"
            onClick={onSelectAll}
          />

          {visibleFolders.map((f) => (
            <FolderTileCard
              key={f.id}
              icon={<Folder className="w-10 h-10 fill-yellow-400 text-yellow-500" />}
              name={f.name}
              count={f.clipCount}
              tone="yellow"
              onClick={() => onSelectFolder(f.id)}
              onRename={async () => {
                const next = prompt("Rename folder", f.name);
                if (next && next.trim() && next.trim() !== f.name) await onRename(f.id, next.trim());
              }}
              onDelete={async () => onDelete(f.id)}
            />
          ))}
        </div>

        {showEmptyHint && (
          <p className="mt-4 text-xs text-muted-foreground text-center">
            Click <span className="font-medium">+ Add Folder</span> to upload your first folder.
          </p>
        )}
      </div>
    </div>
  );
}

interface FolderTileInnerProps {
  icon: React.ReactNode;
  name: string;
  count: number;
  tone: "yellow" | "neutral";
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

function FolderTileCard({ icon, name, count, tone, onClick, onRename, onDelete }: FolderTileInnerProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "relative group rounded-md border p-2 flex flex-col items-center gap-1 cursor-pointer transition aspect-square justify-center",
        tone === "yellow"
          ? "border-border hover:border-yellow-500/60 hover:bg-yellow-500/5"
          : "border-border hover:border-foreground/30 hover:bg-muted/40",
      )}
      onClick={onClick}
    >
      {icon}
      <div className="w-full text-xs text-center truncate" title={name}>
        {name}
      </div>
      <div className="text-[10px] text-muted-foreground">{count} clip{count === 1 ? "" : "s"}</div>

      {(onRename || onDelete) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground"
          aria-label="Folder actions"
        >
          <MoreVertical className="w-3 h-3" />
        </button>
      )}

      {menuOpen && (onRename || onDelete) && (
        <div
          className="absolute top-7 right-1 z-10 bg-popover border border-border rounded-md shadow-md py-1 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onRename(); }}
              className="flex items-center gap-2 px-3 py-1 hover:bg-muted w-full text-left"
            >
              <Pencil className="w-3 h-3" /> Rename
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onDelete(); }}
              className="flex items-center gap-2 px-3 py-1 hover:bg-muted w-full text-left text-destructive"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

Key changes vs the existing file:
- Removed `Layers` icon import; "All clips" now uses a neutral-tone `Folder`.
- Replaced `onCreate(name)` → `onAdd()` (parent handles picker flow).
- Removed `creating`/`newName` state and the inline name input tile.
- Added `busyAdding` / `busyProgress` props for upload progress in the header button.
- Split `onSelect(folderId | null)` into two callbacks: `onSelectAll()` and `onSelectFolder(id)` — clearer call sites in the parent and avoids `null` confusion.
- `FolderTileCard` now uses `aspect-square justify-center` so every tile (yellow + "All clips") is the same square size.
- Added empty-state hint below the grid when no folders exist.

- [ ] **Step 2: Run typecheck to confirm no compile errors**

Run: `pnpm typecheck`
Expected: PASS (no errors). The component is currently unused, so no consumer is broken yet.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/library/folders-grid.tsx
git commit -m "refactor(folders-grid): switch onAdd API, neutral All clips tile, square tiles"
```

---

## Task 2: Rewrite `LibraryPanel` to use the view-state machine

**Files:**
- Modify: `src/components/editor/library/library-panel.tsx`

- [ ] **Step 1: Replace the full file with the new implementation**

Replace the entire contents of `src/components/editor/library/library-panel.tsx` with:

```tsx
"use client";

import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { filterClipsByQuery } from "@/lib/clip-filter";
import { useMediaPool } from "@/state/media-pool";
import { ClipGrid } from "@/components/broll/clip-grid";
import { FoldersGrid, type FolderTile } from "@/components/editor/library/folders-grid";
import { InvalidFilesDialog, type SkippedItem } from "@/components/broll/invalid-files-dialog";
import {
  DuplicateFolderDialog,
  type DuplicateAction,
} from "@/components/broll/duplicate-folder-dialog";
import { DeleteFolderDialog } from "@/components/broll/delete-folder-dialog";
import { resolveCollidingFolderName } from "@/lib/folder-name-collision";
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
  folderId: string;
  folderName: string;
  clipCount: number;
  usedCount: number;
}

type View = "folders" | "clips";

export function LibraryPanel() {
  const mediaPool = useMediaPool();
  const buildState = useBuildState();
  const [fileQuery, setFileQuery] = useState("");
  const [view, setView] = useState<View>("folders");
  const [busyAdding, setBusyAdding] = useState(false);
  const [busyProgress, setBusyProgress] = useState<{ done: number; total: number } | null>(null);

  const [duplicateDialog, setDuplicateDialog] = useState<PendingFolder | null>(null);
  const [invalidDialog, setInvalidDialog] = useState<InvalidDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState | null>(null);

  const folderTiles: FolderTile[] = useMemo(
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

  const currentFolderName = mediaPool.activeFolderId
    ? mediaPool.folders.find((f) => f.id === mediaPool.activeFolderId)?.name ?? "(unknown)"
    : "All clips";

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
      setView("clips");
      setFileQuery("");
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

  function handleSelectAll() {
    mediaPool.setActiveFolderId(null);
    setFileQuery("");
    setView("clips");
  }

  function handleSelectFolder(folderId: string) {
    mediaPool.setActiveFolderId(folderId);
    setFileQuery("");
    setView("clips");
  }

  function handleBack() {
    setView("folders");
  }

  function handleDeleteRequest(folderId: string) {
    const folder = mediaPool.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const folderClipIds = mediaPool.videos.filter((v) => v.folderId === folderId).map((v) => v.id);
    const usedCount = buildState.countOverlaysUsingClips(folderClipIds);
    setDeleteDialog({
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
    const folderClipIds = mediaPool.videos
      .filter((v) => v.folderId === dlg.folderId)
      .map((v) => v.id);
    buildState.removeOverlaysReferencingClips(folderClipIds);
    await mediaPool.removeFolder(dlg.folderId);
    if (mediaPool.activeFolderId === dlg.folderId) {
      mediaPool.setActiveFolderId(null);
      setView("folders");
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {view === "folders" ? (
        <FoldersGrid
          folders={folderTiles}
          totalClipCount={mediaPool.videos.length}
          onSelectAll={handleSelectAll}
          onSelectFolder={handleSelectFolder}
          onAdd={handleAdd}
          onRename={mediaPool.renameFolder}
          onDelete={handleDeleteRequest}
          busyAdding={busyAdding}
          busyProgress={busyProgress}
        />
      ) : (
        <div className="h-full flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Back to folders"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <span className="font-medium truncate" title={currentFolderName}>{currentFolderName}</span>
            <span className="ml-auto text-muted-foreground">{visibleClips.length}</span>
          </div>
          <main className="flex-1 overflow-y-auto p-3 min-w-0">
            <ClipGrid
              clips={visibleClips}
              fileQuery={fileQuery}
              onFileQueryChange={setFileQuery}
            />
          </main>
        </div>
      )}

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
          bulk={false}
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
  const { walkDirectoryHandle, categorizeFiles } = await import("@/lib/folder-import");
  const all: File[] = [];
  for await (const file of walkDirectoryHandle(handle)) all.push(file);
  const { videos, audios } = categorizeFiles(all);
  return { videos, audios, folderName };
}
```

Key behavioral points:
- `view` defaults to `"folders"` — user always sees the grid first.
- After a successful upload, panel auto-navigates to the clips view of the new folder (matches old `setActiveFolderId` behavior + adds `setView("clips")`).
- Back button preserves `activeFolderId` so re-entering the same folder is a no-op.
- After deleting the currently-active folder, navigate back to folders view.
- `FolderSidebar` import removed; `FoldersGrid` imported from the new path.
- Bulk-delete branch removed — the old code path for "delete everything" was triggered from the sidebar; the new grid has no such control. (If you need it back later, add a button in the folders header.)

- [ ] **Step 2: Run lint + typecheck**

Run: `pnpm check`
Expected: PASS. If lint flags unused imports from removed branches, clean them up.

- [ ] **Step 3: Run unit tests**

Run: `pnpm test`
Expected: PASS — no lib code changed, all existing tests should still pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/library/library-panel.tsx
git commit -m "feat(library-panel): switch to CapCut-style folder grid with drill-down"
```

---

## Task 3: Manual UI verification

**Files:** none (verification step)

This task uses the `superpowers:verification-before-completion` skill — no claims of "done" until the dev server has been driven through the flow below.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Open the app in Chrome (folder picker requires Chrome/Edge).

- [ ] **Step 2: Empty state**

Navigate to the editor with no folders loaded. Verify:
- Folders view renders.
- Only the "All clips" tile is visible (count `0`), with a neutral grey/white folder icon.
- Hint text "Click + Add Folder to upload your first folder." appears below the grid.
- Header has `LIBRARY` label, folder search input, and `+ Add Folder` button.

- [ ] **Step 3: Upload a folder**

Click `+ Add Folder` → pick a folder containing several `.mp4` files.
- Button label changes to `Adding X/Y…` while uploading.
- After upload completes, panel auto-switches to the clips view of the new folder.
- Header reads `[← Back] [Folder Name] [N]`.
- ClipGrid shows all imported clips grouped by base name.

- [ ] **Step 4: Drill-down navigation**

Click `← Back`.
- Folders view renders. The new folder shows as a yellow folder tile, square-shaped, same width as the "All clips" tile.
- Grid is 3 columns.

Click the new folder tile → clips view of that folder.
Click `← Back` → folders view again.
Click the "All clips" tile → clips view, header reads "All clips", showing all clips across all folders.

- [ ] **Step 5: Clip search inside folder**

Inside any clips view, type a partial clip name into ClipGrid's search bar.
- Match counter updates ("N clips match").
- Non-matching clips disappear.
- Clear search → all clips return.

- [ ] **Step 6: Folder search**

In folders view, type into the folder search input.
- Yellow folder tiles filter to matching names.
- "All clips" tile remains (it's not part of the filtered list — confirm this is the desired behavior; if the user wants it filterable, follow up).

- [ ] **Step 7: Duplicate folder upload**

Click `+ Add Folder` → pick a folder with the SAME name as an existing one.
- DuplicateFolderDialog opens.
- Choose "Merge" → clips view of the existing folder, count increased.
- Repeat with "Keep both" → new folder with `(2)` suffix appears, panel navigates into it.

- [ ] **Step 8: Rename / Delete folder**

In folders view, hover a yellow folder tile → MoreVertical icon appears top-right.
- Click → menu shows Rename / Delete.
- Rename → prompt opens, type new name → tile updates.
- Delete → DeleteFolderDialog opens with usage info → confirm → folder gone.
- If the deleted folder was active, panel returns to folders view.

- [ ] **Step 9: Drag clip to overlay timeline**

Inside any clips view, drag a clip thumbnail onto the overlay timeline.
- Drop succeeds, overlay clip appears (same behavior as before).

- [ ] **Step 10: Invalid files**

Upload a folder containing a mix of videos and unsupported files (e.g. `.txt`).
- After upload, InvalidFilesDialog opens listing skipped files.

- [ ] **Step 11: Commit verification notes if anything was tweaked during testing**

If any tweaks were needed (CSS spacing, copy adjustments), commit them with a `chore(library-panel): polish after manual verification` message.

---

## Task 4: Final checks

**Files:** none

- [ ] **Step 1: Run full check**

Run: `pnpm check && pnpm test`
Expected: both PASS.

- [ ] **Step 2: Confirm no orphan-import warnings**

Run: `grep -rn "FolderSidebar\|folder-sidebar" src --include="*.tsx" --include="*.ts" | grep -v "^src/components/broll/folder-sidebar.tsx"`
Expected: no matches. `FolderSidebar` should be unused after this refactor.

If there are still importers, leave them — that's fine for this PR; deletion of `folder-sidebar.tsx` is an explicit follow-up.

- [ ] **Step 3: Stop here**

Do not delete `folder-sidebar.tsx`. Cleanup of orphan files is a separate PR. Spec rules: stay focused.

---

## Out of Scope / Follow-ups

- Delete orphan `src/components/broll/folder-sidebar.tsx` once confirmed unused everywhere.
- Drag-to-reorder folders.
- Folder color customization.
- Filter "All clips" tile by folder search query (or hide it when query is non-empty).
- Restore "Clear All" / bulk delete UX in the new grid header if needed.
