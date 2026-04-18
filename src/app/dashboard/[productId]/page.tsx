"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FolderSidebar, type Folder } from "@/components/broll/folder-sidebar";
import { ClipGrid } from "@/components/broll/clip-grid";

type Clip = {
  id: string; brollName: string; filename: string;
  durationMs: number; indexeddbKey: string; folderId: string;
};

export default function WorkspacePage() {
  const { productId } = useParams<{ productId: string }>();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  async function loadFolders() {
    const res = await fetch(`/api/products/${productId}/folders`);
    const data = await res.json();
    setFolders(data);
  }

  async function loadAllClips() {
    const res = await fetch(`/api/products/${productId}/clips`);
    const data = await res.json();
    setClips(data);
  }

  useEffect(() => {
    loadFolders();
    loadAllClips();
  }, [productId]);

  async function handleCreateFolder(name: string) {
    await fetch(`/api/products/${productId}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  }

  async function handleRenameFolder(id: string, name: string) {
    await fetch(`/api/products/${productId}/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  }

  async function handleDeleteFolder(id: string) {
    if (!confirm("Delete this folder and all its clips?")) return;
    const res = await fetch(`/api/products/${productId}/folders/${id}`, { method: "DELETE" });
    const { deletedClipIds } = await res.json();
    if (deletedClipIds?.length) {
      const { deleteProductClips } = await import("@/lib/clip-storage");
      await deleteProductClips(deletedClipIds);
    }
    if (activeFolderId === id) setActiveFolderId(null);
    await loadFolders();
    await loadAllClips();
  }

  const displayedClips = activeFolderId
    ? clips.filter((c) => c.folderId === activeFolderId)
    : clips;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="border-b border-border px-4 flex gap-4">
        <Link href={`/dashboard/${productId}`} className="py-3 text-sm font-medium border-b-2 border-primary">Library</Link>
        <Link href={`/dashboard/${productId}/build`} className="py-3 text-sm font-medium text-muted-foreground hover:text-foreground">Build Video</Link>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <FolderSidebar
          folders={folders}
          activeFolderId={activeFolderId}
          onSelect={setActiveFolderId}
          onCreate={handleCreateFolder}
          onRename={handleRenameFolder}
          onDelete={handleDeleteFolder}
          totalClipCount={clips.length}
        />
        <main className="flex-1 overflow-y-auto p-4">
          <ClipGrid
            clips={displayedClips}
            productId={productId}
            folders={folders}
            activeFolderId={activeFolderId}
            onClipsChanged={loadAllClips}
          />
        </main>
      </div>
    </div>
  );
}
