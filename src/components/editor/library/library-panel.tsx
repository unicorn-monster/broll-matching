"use client";

import { useMemo, useState, useRef } from "react";
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
import { walkDirectoryEntry, groupFilesByFolder, categorizeFiles } from "@/lib/folder-import";
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
  folderClipIds: string[];
}

type View = "folders" | "clips";

export function LibraryPanel() {
  const mediaPool = useMediaPool();
  const buildState = useBuildState();
  const [fileQuery, setFileQuery] = useState("");
  const [view, setView] = useState<View>("folders");
  const [busyAdding, setBusyAdding] = useState(false);
  const [busyProgress, setBusyProgress] = useState<{ done: number; total: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add folder");
    } finally {
      setBusyAdding(false);
      setBusyProgress(null);
    }
  }

  async function handleMultipleFolders(folders: { name: string; files: File[] }[]) {
    setBusyAdding(true);
    let totalAdded = 0;
    let totalRenamed = 0;
    let totalSkipped = 0;
    const takenNames = mediaPool.folders.map((f) => f.name);

    for (let i = 0; i < folders.length; i++) {
      setBusyProgress({ done: i, total: folders.length });
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { name, files } = folders[i]!;
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

  function handleAdd() {
    inputRef.current?.click();
  }

  async function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    e.target.value = "";

    const grouped = groupFilesByFolder(fileList);
    const folders = Array.from(grouped.entries()).map(([name, files]) => ({ name, files }));

    if (folders.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { name, files } = folders[0]!;
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
      folderClipIds,
    });
  }

  async function confirmDelete() {
    if (!deleteDialog) return;
    const dlg = deleteDialog;
    setDeleteDialog(null);
    try {
      buildState.removeOverlaysReferencingClips(dlg.folderClipIds);
      await mediaPool.removeFolder(dlg.folderId);
      if (mediaPool.activeFolderId === dlg.folderId) {
        mediaPool.setActiveFolderId(null);
        setView("folders");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete folder");
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
          onDropFolders={handleDropFolders}
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

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleInputChange}
        {...{ webkitdirectory: "", multiple: true }}
      />
    </div>
  );
}
