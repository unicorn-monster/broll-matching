// src/components/editor/editor-shell.tsx
"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { useMediaPool } from "@/state/media-pool";
import { DeleteFolderDialog } from "@/components/broll/delete-folder-dialog";
import { AudioPill } from "./toolbar/audio-pill";
import { ScriptPill } from "./toolbar/script-pill";
import { TalkingHeadPill } from "./toolbar/talking-head-pill";
import { ExportButton } from "./toolbar/export-button";
import { ShuffleButton } from "./toolbar/shuffle-button";
import { GenerateCaptionsButton } from "./toolbar/generate-captions-button";
import { AddTextButton } from "./toolbar/add-text-button";
import { AudioDialog } from "./dialogs/audio-dialog";
import { ScriptDialog } from "./dialogs/script-dialog";
import { TalkingHeadDialog } from "./dialogs/talking-head-dialog";
import { ExportDialog } from "./dialogs/export-dialog";
import { LibraryPanel } from "./library/library-panel";
import { TimelinePanel } from "./timeline/timeline-panel";
import { PreviewPlayer } from "./preview/preview-player";
import { OverlayDragProvider } from "./overlay/overlay-drag-context";
import { OverlayInspector } from "./overlay/overlay-inspector";
import { TextOverlayInspector } from "./overlay/text-overlay-inspector";
import { AudioInspector } from "./audio/audio-inspector";
import { Button } from "@/components/ui/button";
import { formatMs } from "@/lib/format-time";
import { preloadTextOverlayFonts } from "@/lib/text-overlay/font-loader";

export function EditorShell() {
  const {
    audioDialogOpen,
    setAudioDialogOpen,
    scriptDialogOpen,
    setScriptDialogOpen,
    talkingHeadDialogOpen,
    setTalkingHeadDialogOpen,
    exportDialogOpen,
    setExportDialogOpen,
    previewClipKey,
    setPreviewClipKey,
    inspectorMode,
    selectedOverlayId,
    overlays,
    audioFile,
    setAudio,
    countOverlaysUsingClips,
    removeOverlaysReferencingClips,
    timeline,
    selectedSectionIndex,
    playerSeekRef,
  } = useBuildState();
  const mediaPool = useMediaPool();
  const [clearAllOpen, setClearAllOpen] = useState(false);

  // Fire-and-forget: warm up every (family, weight) used by text overlays so canvas-rendered
  // captions don't fall back to sans-serif on first draw.
  useEffect(() => {
    void preloadTextOverlayFonts();
  }, []);

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
          <TalkingHeadPill />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <GenerateCaptionsButton />
          <AddTextButton />
          <ShuffleButton />
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
          overlays.find((o) => o.id === selectedOverlayId)?.kind === "text"
            ? <TextOverlayInspector overlayId={selectedOverlayId} />
            : <OverlayInspector overlayId={selectedOverlayId} />
        ) : inspectorMode === "audio" ? (
          <AudioInspector />
        ) : (() => {
          const selectedSection = (typeof selectedSectionIndex === "number" && timeline)
            ? timeline[selectedSectionIndex] ?? null
            : null;
          const isTalkingHeadSection = !!selectedSection &&
            selectedSection.clips.some((c) => c.sourceSeekMs !== undefined);

          return inspectorMode === "section" && isTalkingHeadSection && selectedSection ? (
            <div className="h-full p-4 space-y-3">
              <div className="rounded-md border border-purple-500/40 bg-purple-500/5 p-3 space-y-2">
                <div className="text-xs font-semibold text-purple-300">Talking-head slice</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatMs(selectedSection.startMs)} → {formatMs(selectedSection.endMs)}
                  {" "}({(selectedSection.durationMs / 1000).toFixed(2)}s)
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  // eslint-disable-next-line react-hooks/refs
                  onClick={() => playerSeekRef.current?.(selectedSection.startMs)}
                >
                  Preview slice
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Coming soon
            </div>
          );
        })()}
      </div>
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden">
        <TimelinePanel />
      </div>

      <AudioDialog open={audioDialogOpen} onOpenChange={setAudioDialogOpen} />
      <ScriptDialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen} />
      <TalkingHeadDialog open={talkingHeadDialogOpen} onOpenChange={setTalkingHeadDialogOpen} />
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
