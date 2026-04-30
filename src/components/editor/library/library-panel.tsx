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
      void buildState.setAudio(null, null);
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
          {...(deleteDialog.folderCount !== undefined ? { folderCount: deleteDialog.folderCount } : {})}
          {...(deleteDialog.audioCount !== undefined ? { audioCount: deleteDialog.audioCount } : {})}
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
