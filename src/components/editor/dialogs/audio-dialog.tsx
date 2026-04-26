// src/components/editor/dialogs/audio-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AudioUpload } from "@/components/build/audio-upload";
import { useBuildState } from "@/components/build/build-state-context";

interface AudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AudioDialog({ open, onOpenChange }: AudioDialogProps) {
  const { audioFile, audioDuration, setAudio, sections, clearParsed } = useBuildState();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDuration, setPendingDuration] = useState<number | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  // Reset confirm-replace state when the parent dialog closes. Otherwise, if the
  // user closes (e.g., via Esc) while the confirm dialog was queued, it would
  // pop immediately on next open with the stale pending file.
  useEffect(() => {
    if (!open) {
      setConfirmReplace(false);
      setPendingFile(null);
      setPendingDuration(null);
    }
  }, [open]);

  function handleFile(file: File | null, duration: number | null) {
    if (sections && audioFile && file && file !== audioFile) {
      setPendingFile(file);
      setPendingDuration(duration);
      setConfirmReplace(true);
      return;
    }
    setAudio(file, duration);
    if (!file) clearParsed();
  }

  function confirmReplaceProceed() {
    setAudio(pendingFile, pendingDuration);
    clearParsed();
    setConfirmReplace(false);
    setPendingFile(null);
    setPendingDuration(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Audio</DialogTitle>
            <DialogDescription>
              Upload the master MP3. Total length determines the timeline.
            </DialogDescription>
          </DialogHeader>
          <AudioUpload file={audioFile} duration={audioDuration} onFile={handleFile} />
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace audio?</DialogTitle>
            <DialogDescription>
              Sections exist for the current audio. Replacing will clear the parsed script
              and timeline — you&apos;ll need to re-paste the script.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReplace(false)}>Cancel</Button>
            <Button onClick={confirmReplaceProceed}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
