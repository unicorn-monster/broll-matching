"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { ClipGrid } from "@/components/broll/clip-grid";
import { FoldersGrid, type FolderTile } from "./folders-grid";
import { filterClipsByQuery } from "@/lib/clip-filter";

type Clip = {
  id: string;
  brollName: string;
  filename: string;
  durationMs: number;
  indexeddbKey: string;
  folderId: string;
};

interface LibraryPanelProps {
  productId: string;
}

const ALL_CLIPS = "__all__";

export function LibraryPanel({ productId }: LibraryPanelProps) {
  const [folders, setFolders] = useState<FolderTile[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  // null = folder grid view; ALL_CLIPS = "All clips" virtual folder; else folder UUID
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [foldersRes, clipsRes] = await Promise.all([
        fetch(`/api/products/${productId}/folders`),
        fetch(`/api/products/${productId}/clips`),
      ]);
      if (cancelled) return;
      if (foldersRes.ok) setFolders(await foldersRes.json());
      if (clipsRes.ok) setClips(await clipsRes.json());
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function refreshFolders() {
    const res = await fetch(`/api/products/${productId}/folders`);
    if (res.ok) setFolders(await res.json());
  }

  async function refreshClips() {
    const res = await fetch(`/api/products/${productId}/clips`);
    if (res.ok) setClips(await res.json());
  }

  async function handleCreateFolder(name: string) {
    const res = await fetch(`/api/products/${productId}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) await refreshFolders();
  }

  async function handleRenameFolder(id: string, name: string) {
    const res = await fetch(`/api/products/${productId}/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) await refreshFolders();
  }

  async function handleDeleteFolder(id: string) {
    const res = await fetch(`/api/products/${productId}/folders/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    const { deletedClipIds } = await res.json();
    if (deletedClipIds?.length) {
      const { deleteProductClips } = await import("@/lib/clip-storage");
      await deleteProductClips(deletedClipIds);
    }
    if (activeFolderId === id) setActiveFolderId(null);
    await refreshFolders();
    await refreshClips();
  }

  if (activeFolderId === null) {
    return (
      <FoldersGrid
        folders={folders}
        totalClipCount={clips.length}
        onSelect={(id) => setActiveFolderId(id ?? ALL_CLIPS)}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onDelete={handleDeleteFolder}
      />
    );
  }

  const isAll = activeFolderId === ALL_CLIPS;
  const folderForClips = isAll ? null : activeFolderId;
  const headerLabel = isAll ? "All clips" : folders.find((f) => f.id === activeFolderId)?.name ?? "Folder";
  const folderClips = isAll ? clips : clips.filter((c) => c.folderId === activeFolderId);
  const displayedClips = filterClipsByQuery(folderClips, fileQuery);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <button
          type="button"
          onClick={() => setActiveFolderId(null)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Back to folders"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Folders
        </button>
        <span className="font-medium truncate" title={headerLabel}>{headerLabel}</span>
        <span className="ml-auto text-muted-foreground">{displayedClips.length}</span>
      </div>

      <main className="flex-1 overflow-y-auto p-3 min-w-0">
        <ClipGrid
          clips={displayedClips}
          productId={productId}
          activeFolderId={folderForClips}
          onClipsChanged={refreshClips}
          fileQuery={fileQuery}
          onFileQueryChange={setFileQuery}
        />
      </main>
    </div>
  );
}
