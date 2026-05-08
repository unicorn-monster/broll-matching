// src/components/editor/editor-shell.tsx
"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { useMediaPool } from "@/state/media-pool";
import { DeleteFolderDialog } from "@/components/broll/delete-folder-dialog";
import { AudioPill } from "./toolbar/audio-pill";
import { ScriptPill } from "./toolbar/script-pill";
import { ExportButton } from "./toolbar/export-button";
import { AudioDialog } from "./dialogs/audio-dialog";
import { ScriptDialog } from "./dialogs/script-dialog";
import { ExportDialog } from "./dialogs/export-dialog";
import { LibraryPanel } from "./library/library-panel";
import { TimelinePanel } from "./timeline/timeline-panel";
import { PreviewPlayer } from "./preview/preview-player";
import { OverlayDragProvider } from "./overlay/overlay-drag-context";
import { OverlayInspector } from "./overlay/overlay-inspector";
import { AudioInspector } from "./audio/audio-inspector";

export function EditorShell() {
  const {
    audioDialogOpen,
    setAudioDialogOpen,
    scriptDialogOpen,
    setScriptDialogOpen,
    exportDialogOpen,
    setExportDialogOpen,
    previewClipKey,
    setPreviewClipKey,
    inspectorMode,
    selectedOverlayId,
    audioFile,
    setAudio,
    countOverlaysUsingClips,
    removeOverlaysReferencingClips,
  } = useBuildState();
  const mediaPool = useMediaPool();
  const [clearAllOpen, setClearAllOpen] = useState(false);

  useEffect(() => {
    if (previewClipKey === null) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-broll-thumbnail]")) return;
      if (target.closest("[data-broll-preview]")) return;
      setPreviewClipKey(null);
    }
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [previewClipKey, setPreviewClipKey]);

  return (
    <OverlayDragProvider>
    <div
      className="grid h-[calc(100vh-4rem)] w-full bg-background text-foreground"
      style={{
        gridTemplateColumns: "1fr 1fr 1fr",
        gridTemplateRows: "48px 6fr 4fr",
      }}
    >
      <div className="col-span-3 row-start-1 flex items-center gap-3 px-3 border-b border-border bg-muted/30 text-sm">
        <button
          type="button"
          onClick={() => setClearAllOpen(true)}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Clear all"
          title="Clear all (delete all folders + audio)"
          disabled={mediaPool.folders.length === 0 && !audioFile}
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <span className="text-muted-foreground/70 font-mono text-xs truncate max-w-[200px]">
          B-roll Editor
        </span>
        <div className="flex items-center gap-2">
          <AudioPill />
          <ScriptPill />
        </div>
        <div className="ml-auto">
          <ExportButton />
        </div>
      </div>

      <div className="row-start-2 col-start-1 border-r border-border overflow-hidden">
        <LibraryPanel />
      </div>
      <div className="row-start-2 col-start-2 overflow-hidden bg-black/30">
        <PreviewPlayer />
      </div>
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden bg-muted/10">
        {inspectorMode === "overlay" && selectedOverlayId ? (
          <OverlayInspector overlayId={selectedOverlayId} />
        ) : inspectorMode === "audio" ? (
          <AudioInspector />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Coming soon
          </div>
        )}
      </div>
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden">
        <TimelinePanel />
      </div>

      <AudioDialog open={audioDialogOpen} onOpenChange={setAudioDialogOpen} />
      <ScriptDialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen} />
      <ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} />

      {clearAllOpen ? (() => {
        const allClipIds = mediaPool.videos.map((v) => v.id);
        const usedCount = countOverlaysUsingClips(allClipIds);
        return (
          <DeleteFolderDialog
            open
            onOpenChange={setClearAllOpen}
            bulk
            folderName="all folders"
            folderCount={mediaPool.folders.length}
            clipCount={mediaPool.videos.length}
            audioCount={audioFile ? 1 : 0}
            usedCount={usedCount}
            onConfirm={async () => {
              removeOverlaysReferencingClips(allClipIds);
              await mediaPool.reset();
              void setAudio(null, null);
              setClearAllOpen(false);
            }}
          />
        );
      })() : null}
    </div>
    </OverlayDragProvider>
  );
}
