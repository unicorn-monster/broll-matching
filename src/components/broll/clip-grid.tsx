"use client";

import { useState, useEffect } from "react";
import { Trash2, Pencil, Upload, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getThumbnail } from "@/lib/clip-storage";
import { deriveBaseName, isValidBrollName } from "@/lib/broll";
import { formatMs } from "@/lib/format-time";
import { ClipUpload } from "./clip-upload";
import { useBuildState } from "@/components/build/build-state-context";
import { useOverlayDragSource } from "@/components/editor/overlay/overlay-drag-source";

type Clip = {
  id: string; brollName: string; filename: string;
  durationMs: number; indexeddbKey: string; folderId: string;
};

interface ClipGridProps {
  clips: Clip[];
  productId: string;
  activeFolderId: string | null;
  onClipsChanged: () => void;
  fileQuery: string;
  onFileQueryChange: (q: string) => void;
}

function ThumbnailImage({ clipId }: { clipId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    getThumbnail(clipId).then((buf) => {
      if (buf) setSrc(URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
    });
  }, [clipId]);
  return src
    ? <img src={src} alt="" className="w-full h-full object-cover" />
    : <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">No preview</div>;
}

interface ClipTileProps {
  clip: Clip;
  onPreview: (key: string) => void;
  onEdit: (id: string, name: string) => void;
  onDelete: (clip: Clip) => void;
  editingId: string | null;
  editName: string;
  setEditName: (n: string) => void;
  onRename: (clip: Clip) => void;
  onCancelEdit: () => void;
}

function ClipTile({ clip, onPreview, onEdit, onDelete, editingId, editName, setEditName, onRename, onCancelEdit }: ClipTileProps) {
  const dragProps = useOverlayDragSource({
    clipId: clip.id,
    indexeddbKey: clip.indexeddbKey,
    durationMs: clip.durationMs,
    thumbnailUrl: null,
  });
  return (
    <div
      key={clip.id}
      data-broll-thumbnail
      {...dragProps}
      onClick={() => onPreview(clip.indexeddbKey)}
      className="group relative border border-border rounded-lg overflow-hidden bg-muted/20 cursor-pointer"
    >
      <div className="aspect-[4/5] relative">
        <ThumbnailImage clipId={clip.indexeddbKey} />
        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
          {formatMs(clip.durationMs)}
        </div>
      </div>
      <div className="p-1.5">
        {editingId === clip.id ? (
          <div className="flex gap-1">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(clip);
                if (e.key === "Escape") onCancelEdit();
              }}
              autoFocus
              className="h-6 text-xs"
            />
            <button onClick={(e) => { e.stopPropagation(); onRename(clip); }} className="text-xs text-green-600">✓</button>
          </div>
        ) : (
          <p className="text-xs truncate font-mono">{clip.brollName}</p>
        )}
      </div>
      <div className="absolute top-1 right-1 hidden group-hover:flex gap-1 bg-black/60 rounded p-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(clip.id, clip.brollName); }}
          className="text-white hover:text-yellow-300"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(clip); }} className="text-white hover:text-red-400">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function ClipGrid({ clips, productId, activeFolderId, onClipsChanged, fileQuery, onFileQueryChange }: ClipGridProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const { setPreviewClipKey } = useBuildState();

  const groups = clips.reduce<Record<string, Clip[]>>((acc, clip) => {
    const base = deriveBaseName(clip.brollName);
    if (!acc[base]) acc[base] = [];
    acc[base].push(clip);
    return acc;
  }, {});

  async function handleDelete(clip: Clip) {
    if (!confirm(`Delete ${clip.brollName}?`)) return;
    const res = await fetch(`/api/products/${productId}/clips/${clip.id}`, { method: "DELETE" });
    if (res.ok) {
      const { deleteClip } = await import("@/lib/clip-storage");
      await deleteClip(clip.id);
      onClipsChanged();
    }
  }

  async function handleRename(clip: Clip) {
    if (!isValidBrollName(editName)) {
      alert("Invalid name. Must match pattern: name-01 (lowercase, ends with -NN)");
      return;
    }
    const res = await fetch(`/api/products/${productId}/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brollName: editName }),
    });
    if (res.ok) { setEditingId(null); onClipsChanged(); }
    else { const d = await res.json(); alert(d.error); }
  }

  return (
    <div className="space-y-6">
      {/* Top bar: search + upload */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={fileQuery}
            onChange={(e) => onFileQueryChange(e.target.value)}
            placeholder="Search clips by name..."
            className="h-9 text-sm pl-9 pr-8"
          />
          {fileQuery && (
            <button
              onClick={() => onFileQueryChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {activeFolderId && (
          <Button variant="outline" onClick={() => setShowUpload((v) => !v)}>
            <Upload className="w-4 h-4 mr-2" />{showUpload ? "Hide Upload" : "Upload Clips"}
          </Button>
        )}
      </div>

      {/* Match counter */}
      {fileQuery.trim() && (
        <p className="text-xs text-muted-foreground -mt-4">
          {clips.length} {clips.length === 1 ? "clip" : "clips"} match
        </p>
      )}

      {/* Upload panel */}
      {showUpload && activeFolderId && (
        <ClipUpload
          productId={productId}
          folderId={activeFolderId}
          onDone={() => { setShowUpload(false); onClipsChanged(); }}
        />
      )}

      {/* Empty states */}
      {clips.length === 0 && fileQuery.trim() && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p>No clips match &ldquo;{fileQuery}&rdquo;</p>
        </div>
      )}
      {clips.length === 0 && !fileQuery.trim() && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
          <p>{activeFolderId ? "No clips in this folder." : "No clips yet."}</p>
          {activeFolderId && (
            <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4 mr-2" />Upload Clips</Button>
          )}
        </div>
      )}

      {/* Clip groups */}
      {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([base, groupClips]) => (
        <div key={base}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
            {base}
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{groupClips.length}</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {groupClips.map((clip) => (
              <ClipTile
                key={clip.id}
                clip={clip}
                onPreview={setPreviewClipKey}
                onEdit={(id, name) => { setEditingId(id); setEditName(name); }}
                onDelete={handleDelete}
                editingId={editingId}
                editName={editName}
                setEditName={setEditName}
                onRename={handleRename}
                onCancelEdit={() => setEditingId(null)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
