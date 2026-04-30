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
