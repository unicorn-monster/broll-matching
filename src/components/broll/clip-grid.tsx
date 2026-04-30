"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMediaPool } from "@/state/media-pool";
import { deriveBaseName } from "@/lib/broll";
import { formatMs } from "@/lib/format-time";
import { useBuildState } from "@/components/build/build-state-context";
import { useOverlayDragSource } from "@/components/editor/overlay/overlay-drag-source";

type Clip = {
  id: string; brollName: string; filename: string;
  durationMs: number; fileId: string; folderId: string;
};

interface ClipGridProps {
  clips: Clip[];
  fileQuery: string;
  onFileQueryChange: (q: string) => void;
}

function ThumbnailImage({ clipId }: { clipId: string }) {
  const mediaPool = useMediaPool();
  // Synchronous lookup — pool manages URL lifetime, no cleanup needed
  const src = mediaPool.getFileURL(clipId);
  return src
    ? (
      // Video shows first frame automatically when paused/not playing
      <video src={src} preload="metadata" muted playsInline className="w-full h-full object-cover" />
    )
    : <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">No preview</div>;
}

interface ClipTileProps {
  clip: Clip;
  onPreview: (key: string) => void;
}

function ClipTile({ clip, onPreview }: ClipTileProps) {
  const dragProps = useOverlayDragSource({
    clipId: clip.id,
    fileId: clip.fileId,
    durationMs: clip.durationMs,
    thumbnailUrl: null,
  });
  return (
    <div
      key={clip.id}
      data-broll-thumbnail
      {...dragProps}
      onClick={() => onPreview(clip.fileId)}
      className="group relative border border-border rounded-lg overflow-hidden bg-muted/20 cursor-pointer"
    >
      <div className="aspect-[4/5] relative">
        <ThumbnailImage clipId={clip.fileId} />
        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
          {formatMs(clip.durationMs)}
        </div>
      </div>
      <div className="p-1.5">
        <p className="text-xs truncate font-mono">{clip.brollName}</p>
      </div>
    </div>
  );
}

export function ClipGrid({ clips, fileQuery, onFileQueryChange }: ClipGridProps) {
  const { setPreviewClipKey } = useBuildState();

  const groups = clips.reduce<Record<string, Clip[]>>((acc, clip) => {
    const base = deriveBaseName(clip.brollName);
    if (!acc[base]) acc[base] = [];
    acc[base].push(clip);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="relative max-w-sm">
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

      {/* Match counter */}
      {fileQuery.trim() && (
        <p className="text-xs text-muted-foreground -mt-4">
          {clips.length} {clips.length === 1 ? "clip" : "clips"} match
        </p>
      )}

      {/* Empty states */}
      {clips.length === 0 && fileQuery.trim() && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
          <p>No clips match &ldquo;{fileQuery}&rdquo;</p>
        </div>
      )}
      {clips.length === 0 && !fileQuery.trim() && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
          <p>No clips loaded yet. Pick a folder to get started.</p>
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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
