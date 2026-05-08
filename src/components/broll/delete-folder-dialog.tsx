"use client";

import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderName: string;
  clipCount: number;
  usedCount: number;
  onConfirm: () => void;
  bulk?: boolean;
  audioCount?: number;
  folderCount?: number;
}

export function DeleteFolderDialog({
  open,
  onOpenChange,
  folderName,
  clipCount,
  usedCount,
  onConfirm,
  bulk = false,
  audioCount = 0,
  folderCount = 0,
}: Props) {
  const title = bulk
    ? "Clear entire project?"
    : `Delete folder "${folderName}"?`;

  const description = bulk ? (
    <>
      This will delete <strong>{folderCount}</strong>{" "}
      {folderCount === 1 ? "folder" : "folders"}, <strong>{clipCount}</strong>{" "}
      {clipCount === 1 ? "clip" : "clips"}
      {audioCount > 0 ? <>, and <strong>1</strong> audio</> : null}.
    </>
  ) : (
    <>
      This will permanently delete the folder and{" "}
      <strong>
        {clipCount} {clipCount === 1 ? "clip" : "clips"}
      </strong>
      .
    </>
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {usedCount > 0 ? (
          <div className="flex items-start gap-2 text-sm rounded border border-amber-500/40 bg-amber-500/10 p-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              {usedCount} {usedCount === 1 ? "overlay" : "overlays"} in your timeline{" "}
              {usedCount === 1 ? "uses" : "use"} clips from {bulk ? "these folders" : "this folder"}.
              {" "}They will be removed.
            </span>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">This cannot be undone.</p>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(buttonVariants({ variant: "destructive" }))}
          >
            {bulk ? "Clear all" : "Delete folder"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
