// src/components/editor/editor-shell.tsx
"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
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
  } = useBuildState();

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
          onClick={() => window.location.reload()}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back to folder picker"
          title="Back to folder picker"
        >
          <RotateCcw className="w-4 h-4" />
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
    </div>
    </OverlayDragProvider>
  );
}
