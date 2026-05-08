"use client";

import { Button } from "@/components/ui/button";
import { useMediaPool } from "@/state/media-pool";
import { formatMs } from "@/lib/format-time";
import type { ClipMetadata } from "@/lib/auto-match";

interface PreviewPaneProps {
  clip: ClipMetadata | null;
  /** Label for the action button — e.g. "Use for slot 1" or "Add to chain". */
  actionLabel: string;
  /** Disabled when no active slot is selected. */
  actionDisabled?: boolean;
  onUse: () => void;
}

export function PreviewPane({ clip, actionLabel, actionDisabled, onUse }: PreviewPaneProps) {
  const mediaPool = useMediaPool();
  // Synchronous lookup — pool manages URL lifetime, no cleanup needed
  const videoSrc = clip ? mediaPool.getFileURL(clip.fileId) : null;

  if (!clip) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-8 text-center border border-dashed border-border rounded-md">
        Select a variant on the left to preview.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1 bg-black rounded-md overflow-hidden flex items-center justify-center">
        {videoSrc ? (
          <video
            key={clip.id}
            src={videoSrc}
            controls
            playsInline
            className="max-w-full max-h-full"
          />
        ) : (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}
      </div>
      <div className="text-sm space-y-0.5">
        <div className="font-medium truncate">{clip.brollName}</div>
        <div className="text-muted-foreground text-xs">
          {formatMs(clip.durationMs)} · {clip.width}×{clip.height}
        </div>
      </div>
      <Button onClick={onUse} disabled={actionDisabled} className="w-full">
        {actionLabel}
      </Button>
    </div>
  );
}
