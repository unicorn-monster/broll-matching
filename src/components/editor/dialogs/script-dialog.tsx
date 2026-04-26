// src/components/editor/dialogs/script-dialog.tsx
"use client";

import { useEffect, useState } from "react";
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
import { deriveBaseName } from "@/lib/broll";
import { buildClipsByBaseName, type ClipMetadata, type MatchedSection } from "@/lib/auto-match";
import { preserveLocks } from "@/lib/lock-preserve";
import type { ParsedSection } from "@/lib/script-parser";

interface ScriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
}

export function ScriptDialog({ open, onOpenChange, productId }: ScriptDialogProps) {
  const { scriptText, setScriptText, timeline, onParsed, setTimeline } = useBuildState();
  const [availableBaseNames, setAvailableBaseNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    fetch(`/api/products/${productId}/clips`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch clips: ${r.status}`);
        return r.json();
      })
      .then((clips: { brollName: string }[]) => {
        setAvailableBaseNames(new Set(clips.map((c) => deriveBaseName(c.brollName))));
      })
      .catch(() => {
        // Silent — availableBaseNames stays empty; ScriptPaste still works without hints
      });
  }, [productId, open]);

  async function handleParsed(newSections: ParsedSection[], freshTimeline: MatchedSection[]) {
    const hasLocks = !!timeline && timeline.some((s) => s.userLocked);
    if (!hasLocks) {
      onParsed(newSections, freshTimeline);
      onOpenChange(false);
      return;
    }
    const clipsRes = await fetch(`/api/products/${productId}/clips`);
    if (!clipsRes.ok) {
      onParsed(newSections, freshTimeline);
      onOpenChange(false);
      return;
    }
    interface RawClip { brollName: string; createdAt: string; [key: string]: unknown }
    const rawClips: RawClip[] = await clipsRes.json();
    const clips: ClipMetadata[] = rawClips.map((c) => ({
      ...c,
      baseName: deriveBaseName(c.brollName),
      createdAt: new Date(c.createdAt),
    }) as ClipMetadata);
    const map = buildClipsByBaseName(clips);
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Script</DialogTitle>
          <DialogDescription>
            One line per section: <code>HH:MM:SS,mmm --&gt; HH:MM:SS,mmm || tag || text</code>
          </DialogDescription>
        </DialogHeader>
        <ScriptPaste
          text={scriptText}
          onTextChange={setScriptText}
          availableBaseNames={availableBaseNames}
          productId={productId}
          onParsed={handleParsed}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
