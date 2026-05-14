// src/components/editor/dialogs/export-dialog.tsx
"use client";

import { useState } from "react";
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
  const { audioFile, audioDuration, timeline, overlays } = useBuildState();
  const hasCaptions = overlays.some((o) => o.kind === "text");
  // Default ON when captions exist — the common case is "I built captions, I want them burned in".
  // Toggle gives an escape hatch for A/B testing uncaptioned variants.
  const [includeCaptions, setIncludeCaptions] = useState(true);
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
          <div className="space-y-3">
            {hasCaptions && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeCaptions}
                  onChange={(e) => setIncludeCaptions(e.target.checked)}
                />
                Include captions
              </label>
            )}
            <RenderTrigger
              audioFile={audioFile}
              audioDurationMs={audioDuration ? audioDuration * 1000 : 0}
              timeline={timeline}
              includeCaptions={includeCaptions && hasCaptions}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Audio + script required to export.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
