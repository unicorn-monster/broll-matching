"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getClip } from "@/lib/clip-storage";
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
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!clip) {
      setVideoSrc(null);
      return;
    }
    let objectUrl: string | null = null;
    let active = true;
    getClip(clip.id).then((buf) => {
      if (!active || !buf) return;
      objectUrl = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
      setVideoSrc(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setVideoSrc(null);
    };
  }, [clip?.id]);

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
