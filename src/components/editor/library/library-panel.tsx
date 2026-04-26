"use client";

import { useEffect, useState } from "react";
import { FolderSidebar, type Folder } from "@/components/broll/folder-sidebar";
import { ClipGrid } from "@/components/broll/clip-grid";
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

export function LibraryPanel({ productId }: LibraryPanelProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");

  function handleFileQueryChange(q: string) {
    setFileQuery(q);
    if (q.trim()) setActiveFolderId(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    async function load() {
      const [foldersRes, clipsRes] = await Promise.all([
        fetch(`/api/products/${productId}/folders`, { signal }),
        fetch(`/api/products/${productId}/clips`, { signal }),
      ]);
      if (cancelled) return;
      if (foldersRes.ok) setFolders(await foldersRes.json());
      if (clipsRes.ok) setClips(await clipsRes.json());
    }

    load().catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
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
    if (!confirm("Delete this folder and all its clips?")) return;
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

  const displayedClips = fileQuery.trim()
    ? filterClipsByQuery(clips, fileQuery)
    : activeFolderId
      ? clips.filter((c) => c.folderId === activeFolderId)
      : clips;

  return (
    <div className="flex h-full overflow-hidden">
      <FolderSidebar
        folders={folders}
        activeFolderId={activeFolderId}
        onSelect={setActiveFolderId}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onDelete={handleDeleteFolder}
        totalClipCount={clips.length}
      />
      <main className="flex-1 overflow-y-auto p-3 min-w-0">
        <ClipGrid
          clips={displayedClips}
          productId={productId}
          activeFolderId={activeFolderId}
          onClipsChanged={refreshClips}
          fileQuery={fileQuery}
          onFileQueryChange={handleFileQueryChange}
        />
      </main>
    </div>
  );
}
