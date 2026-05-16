// src/components/editor/dialogs/script-dialog.tsx
"use client";

import { useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScriptPaste } from "@/components/build/script-paste";
import { useBuildState } from "@/components/build/build-state-context";
import { useMediaPool } from "@/state/media-pool";
import { buildClipsByBaseName, type MatchedSection } from "@/lib/auto-match";
import { preserveLocks } from "@/lib/lock-preserve";
import type { ParsedSection } from "@/lib/script-parser";

interface ScriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScriptDialog({ open, onOpenChange }: ScriptDialogProps) {
  const { scriptText, setScriptText, timeline, onParsed, setTimeline, audioDuration } = useBuildState();
  const mediaPool = useMediaPool();

  // Derive available base names directly from the media pool — no API fetch needed
  const availableBaseNames = useMemo(
    () => new Set(mediaPool.videos.map((v) => v.baseName)),
    [mediaPool.videos],
  );

  // Tracks the in-flight parse so a stale resolution can't overwrite newer state
  // when handleParsed is called twice in quick succession.
  const inFlightRef = useRef<AbortController | null>(null);

  async function handleParsed(newSections: ParsedSection[], freshTimeline: MatchedSection[]) {
    // Cancel any prior in-flight handleParsed so its late resolution can't
    // clobber a newer parse (e.g., user pastes twice in quick succession).
    inFlightRef.current?.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;

    const hasLocks = !!timeline && timeline.some((s) => s.userLocked);
    if (!hasLocks) {
      onParsed(newSections, freshTimeline);
      onOpenChange(false);
      return;
    }

    if (ctrl.signal.aborted) return;

    // Build clip map from the media pool — no API call needed
    const map = buildClipsByBaseName(mediaPool.videos);
    const oldSnapshot = timeline!;
    const result = preserveLocks(timeline!, newSections, map);
    onParsed(newSections, result.newTimeline);

    toast.success(
      `${newSections.length} sections · ${result.preservedCount} locks preserved · ${result.droppedCount} dropped`,
      {
        action:
          result.preservedCount + result.droppedCount > 0
            ? { label: "Undo", onClick: () => setTimeline(oldSnapshot) }
            : undefined,
        duration: 30_000,
      },
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Script</DialogTitle>
          <DialogDescription>
            One line per section: <code>HH:MM:SS,mmm --&gt; HH:MM:SS,mmm || text || tag</code>
          </DialogDescription>
        </DialogHeader>
        <ScriptPaste
          text={scriptText}
          onTextChange={setScriptText}
          availableBaseNames={availableBaseNames}
          audioDurationMs={audioDuration ? audioDuration * 1000 : null}
          onParsed={handleParsed}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
