"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type DuplicateAction = "new" | "merge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingFolderName: string;
  existingClipCount: number;
  proposedNewName: string;
  onChoose: (action: DuplicateAction) => void;
}

export function DuplicateFolderDialog({
  open,
  onOpenChange,
  existingFolderName,
  existingClipCount,
  proposedNewName,
  onChoose,
}: Props) {
  const [action, setAction] = useState<DuplicateAction>("new");

  function handleContinue() {
    onChoose(action);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Folder &ldquo;{existingFolderName}&rdquo; already exists</DialogTitle>
          <DialogDescription>
            You already have a folder named &ldquo;{existingFolderName}&rdquo; with {existingClipCount}{" "}
            {existingClipCount === 1 ? "clip" : "clips"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>How would you like to add the new files?</p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-action"
              value="new"
              checked={action === "new"}
              onChange={() => setAction("new")}
              className="mt-1"
            />
            <span>
              Add as a new folder &ldquo;<span className="font-mono">{proposedNewName}</span>&rdquo;
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="dup-action"
              value="merge"
              checked={action === "merge"}
              onChange={() => setAction("merge")}
              className="mt-1"
            />
            <span>
              Merge into existing &ldquo;{existingFolderName}&rdquo;
              <br />
              <span className="text-xs text-muted-foreground">
                (skip files with duplicate broll names)
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleContinue}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
