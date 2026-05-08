"use client";

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface SkippedItem {
  filename: string;
  reason: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  added: number;
  skipped: SkippedItem[];
}

export function InvalidFilesDialog({ open, onOpenChange, folderName, added, skipped }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Some files were skipped</DialogTitle>
          <DialogDescription>
            Folder &ldquo;{folderName}&rdquo; uploaded with {added} valid {added === 1 ? "clip" : "clips"}.
            {" "}{skipped.length} {skipped.length === 1 ? "file was" : "files were"} skipped because their
            names don&apos;t match the required pattern.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-xs">
          <p>
            <span className="font-medium">Required:</span> <code>tag-NN.mp4</code>{" "}
            <span className="text-muted-foreground">
              (lowercase tag + dash + number, e.g. <code>hook-01.mp4</code>)
            </span>
          </p>
          <div className="border border-border rounded max-h-64 overflow-y-auto divide-y divide-border">
            {skipped.map((s, i) => (
              <div key={i} className="p-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-mono truncate">{s.filename}</div>
                  <div className="text-muted-foreground">Reason: {s.reason}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground">Rename the files and re-upload the folder.</p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
