"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: () => void;
  onMerge: () => void;
}

export function GenerateCaptionsDialog({ open, onOpenChange, onReplace, onMerge }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate captions from script</DialogTitle>
          <DialogDescription>
            You already have text overlays. Replace will re-create captions for every script section
            (manual text overlays are preserved). Merge keeps your existing edits — only new sections
            get new captions and removed sections are dropped.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={onMerge}>Merge</Button>
          <Button variant="destructive" onClick={onReplace}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
