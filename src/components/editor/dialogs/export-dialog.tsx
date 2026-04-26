// src/components/editor/dialogs/export-dialog.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RenderTrigger } from "@/components/build/render-trigger";
import { useBuildState } from "@/components/build/build-state-context";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const { audioFile, timeline } = useBuildState();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Renders the timeline + audio with FFmpeg.wasm and downloads an MP4.
          </DialogDescription>
        </DialogHeader>
        {audioFile && timeline ? (
          <RenderTrigger audioFile={audioFile} timeline={timeline} />
        ) : (
          <p className="text-sm text-muted-foreground">Audio + script required to export.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
