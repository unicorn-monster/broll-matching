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
import { TalkingHeadUpload } from "@/components/build/audio-upload";
import { useBuildState } from "@/components/build/build-state-context";

interface TalkingHeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TalkingHeadDialog({ open, onOpenChange }: TalkingHeadDialogProps) {
  const { talkingHeadFile, talkingHeadTag, setTalkingHead, setTalkingHeadTag, sections } =
    useBuildState();

  const [thFile, setThFile] = useState<File | null>(talkingHeadFile);
  const [thDuration, setThDuration] = useState<number | null>(null);

  useEffect(() => { setThFile(talkingHeadFile); }, [talkingHeadFile]);
  useEffect(() => {
    if (!open) setThDuration(null);
  }, [open]);

  function handleTalkingHead(file: File | null, duration: number | null) {
    setThFile(file);
    setThDuration(duration);
    setTalkingHead(file);
  }

  const tagInScript = !!sections && sections.some((s) => s.tag.toLowerCase() === talkingHeadTag);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Talking-Head</DialogTitle>
          <DialogDescription>
            Upload a silent talking-head MP4 (same length as the master audio). Sections tagged
            with the configured tag are auto-sliced from this file by absolute timestamp.
          </DialogDescription>
        </DialogHeader>
        <TalkingHeadUpload
          file={thFile}
          duration={thDuration}
          tag={talkingHeadTag}
          tagInScript={tagInScript}
          onFile={handleTalkingHead}
          onTagChange={setTalkingHeadTag}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
