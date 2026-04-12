"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Trash2, Film, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { getThumbnail, deleteClip as deleteFromIndexedDB } from "@/lib/clip-storage";
import { ClipUpload } from "@/components/broll/clip-upload";

interface ClipMetadata {
  id: string;
  tagId: string;
  filename: string;
  durationMs: number;
  width: number;
  height: number;
  indexeddbKey: string;
  fileSizeBytes: number;
  createdAt: string;
}

interface TagInfo {
  id: string;
  name: string;
  clipCount: number;
}

interface ClipGridProps {
  productId: string;
  tagId: string;
  tag: TagInfo | null;
  onClipsChanged: () => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTotalStorage(clips: ClipMetadata[]): string {
  const total = clips.reduce((sum, c) => sum + c.fileSizeBytes, 0);
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(0)} KB`;
  if (total < 1024 * 1024 * 1024) return `${(total / (1024 * 1024)).toFixed(1)} MB`;
  return `${(total / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ClipGrid({ productId, tagId, tag, onClipsChanged }: ClipGridProps) {
  const [clips, setClips] = useState<ClipMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const blobUrlsRef = useRef<string[]>([]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingClip, setDeletingClip] = useState<ClipMetadata | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchClips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/tags/${tagId}/clips`);
      if (!res.ok) return;
      const data: ClipMetadata[] = await res.json();
      setClips(data);
      // Load thumbnails from IndexedDB
      loadThumbnails(data);
    } finally {
      setLoading(false);
    }
  }, [productId, tagId]);

  async function loadThumbnails(clipList: ClipMetadata[]) {
    const newMap = new Map<string, string>();
    await Promise.all(
      clipList.map(async (clip) => {
        const data = await getThumbnail(clip.id);
        if (data) {
          const blob = new Blob([data], { type: "image/jpeg" });
          const url = URL.createObjectURL(blob);
          blobUrlsRef.current.push(url);
          newMap.set(clip.id, url);
        }
      })
    );
    setThumbnails(newMap);
  }

  useEffect(() => {
    // Revoke old blob URLs when tagId changes or component unmounts
    const urlsToRevoke = [...blobUrlsRef.current];
    blobUrlsRef.current = [];
    urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
    setThumbnails(new Map());
    fetchClips();
  }, [fetchClips]);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function openDelete(clip: ClipMetadata) {
    setDeletingClip(clip);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletingClip) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/tags/${tagId}/clips/${deletingClip.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete clip");
      // Remove from IndexedDB
      await deleteFromIndexedDB(deletingClip.id);
      // Revoke blob URL
      const url = thumbnails.get(deletingClip.id);
      if (url) URL.revokeObjectURL(url);
      toast.success("Clip deleted");
      setDeleteOpen(false);
      setDeletingClip(null);
      onClipsChanged();
      fetchClips();
    } catch {
      toast.error("Failed to delete clip");
    } finally {
      setDeleteLoading(false);
    }
  }

  function handleUploaded() {
    onClipsChanged();
    fetchClips();
  }

  const totalStorage = formatTotalStorage(clips);

  return (
    <div className="flex flex-col h-full">
      {/* Tag header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold text-sm">{tag?.name}</h2>
          <p className="text-xs text-muted-foreground">
            {clips.length} {clips.length === 1 ? "clip" : "clips"}
            {clips.length > 0 && ` · ${totalStorage}`}
          </p>
        </div>
        {clips.length > 0 && (
          <ClipUpload
            productId={productId}
            tagId={tagId}
            onUploaded={handleUploaded}
            compact
          />
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-md" />
            ))}
          </div>
        </div>
      ) : clips.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Film className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="font-medium text-sm mb-1">No clips yet</h3>
          <p className="text-xs text-muted-foreground mb-5 text-center max-w-xs">
            Upload MP4 clips for the <strong>{tag?.name}</strong> tag. They&apos;ll be transcoded to 1080×1350 automatically.
          </p>
          <ClipUpload
            productId={productId}
            tagId={tagId}
            onUploaded={handleUploaded}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                thumbnailUrl={thumbnails.get(clip.id)}
                onDelete={() => openDelete(clip)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete clip?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{deletingClip?.filename}</strong> ({deletingClip ? formatBytes(deletingClip.fileSizeBytes) : ""})
            will be permanently deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClipCard({
  clip,
  thumbnailUrl,
  onDelete,
}: {
  clip: ClipMetadata;
  thumbnailUrl: string | undefined;
  onDelete: () => void;
}) {
  return (
    <div className="group relative aspect-[9/16] rounded-md overflow-hidden bg-muted border border-border">
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={clip.filename}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <HardDrive className="w-6 h-6 text-muted-foreground/40" />
        </div>
      )}

      {/* Duration badge */}
      <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
        {formatDuration(clip.durationMs)}
      </div>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-destructive text-white rounded p-1"
        aria-label="Delete clip"
      >
        <Trash2 className="w-3 h-3" />
      </button>

      {/* Filename tooltip on hover */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-6 pt-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white truncate">{clip.filename}</p>
      </div>
    </div>
  );
}
