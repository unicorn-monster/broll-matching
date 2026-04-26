// src/components/editor/editor-shell.tsx
"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { AudioPill } from "./toolbar/audio-pill";
import { ScriptPill } from "./toolbar/script-pill";
import { ExportButton } from "./toolbar/export-button";
import { AudioDialog } from "./dialogs/audio-dialog";
import { ScriptDialog } from "./dialogs/script-dialog";
import { ExportDialog } from "./dialogs/export-dialog";
import { LibraryPanel } from "./library/library-panel";

interface EditorShellProps {
  productId: string;
}

export function EditorShell({ productId }: EditorShellProps) {
  const {
    audioDialogOpen,
    setAudioDialogOpen,
    scriptDialogOpen,
    setScriptDialogOpen,
    exportDialogOpen,
    setExportDialogOpen,
  } = useBuildState();

  return (
    <div
      className="grid h-[calc(100vh-4rem)] w-full bg-background text-foreground"
      style={{
        gridTemplateColumns: "320px 1fr 360px",
        gridTemplateRows: "48px 1fr 220px",
      }}
    >
      <div className="col-span-3 row-start-1 flex items-center gap-3 px-3 border-b border-border bg-muted/30 text-sm">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground" aria-label="Back to projects">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <span className="text-muted-foreground/70 font-mono text-xs truncate max-w-[200px]">
          {productId}
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
        <LibraryPanel productId={productId} />
      </div>
      <div className="row-start-2 col-start-2 overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-black/30">
        Preview
      </div>
      <div className="row-start-2 col-start-3 border-l border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm">
        Inspector
      </div>
      <div className="col-span-3 row-start-3 border-t border-border overflow-hidden flex items-center justify-center text-muted-foreground text-sm bg-muted/10">
        Timeline
      </div>

      <AudioDialog open={audioDialogOpen} onOpenChange={setAudioDialogOpen} />
      <ScriptDialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen} productId={productId} />
      <ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} />
    </div>
  );
}
