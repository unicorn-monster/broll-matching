"use client";

import { useState } from "react";
import { filterClipsByQuery } from "@/lib/clip-filter";
import { useMediaPool } from "@/state/media-pool";
import { ClipGrid } from "@/components/broll/clip-grid";

export function LibraryPanel() {
  const [fileQuery, setFileQuery] = useState("");

  // All clips come from the media pool — no folder API calls needed
  const mediaPool = useMediaPool();
  const clips = mediaPool.videos;

  const displayedClips = filterClipsByQuery(clips, fileQuery);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <span className="font-medium">Clips</span>
        <span className="ml-auto text-muted-foreground">{displayedClips.length}</span>
      </div>

      <main className="flex-1 overflow-y-auto p-3 min-w-0">
        <ClipGrid
          clips={displayedClips}
          fileQuery={fileQuery}
          onFileQueryChange={setFileQuery}
        />
      </main>
    </div>
  );
}
