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
import { AudioUpload, TalkingHeadUpload } from "@/components/build/audio-upload";
import { useBuildState } from "@/components/build/build-state-context";

interface AudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AudioDialog({ open, onOpenChange }: AudioDialogProps) {
  const {
    audioFile, audioDuration, setAudio, sections, clearParsed,
    talkingHeadFile, talkingHeadTag, setTalkingHead, setTalkingHeadTag,
  } = useBuildState();

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDuration, setPendingDuration] = useState<number | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const [thFile, setThFile] = useState<File | null>(talkingHeadFile);
  const [thDuration, setThDuration] = useState<number | null>(null);

  useEffect(() => { setThFile(talkingHeadFile); }, [talkingHeadFile]);

  useEffect(() => {
    if (!open) {
      setConfirmReplace(false);
      setPendingFile(null);
      setPendingDuration(null);
    }
  }, [open]);

  function handleAudio(file: File | null, duration: number | null) {
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

  function handleTalkingHead(file: File | null, duration: number | null) {
    setThFile(file);
    setThDuration(duration);
    setTalkingHead(file);
  }

  const tagInScript = !!sections && sections.some((s) => s.tag.toLowerCase() === talkingHeadTag);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Audio &amp; Talking-Head</DialogTitle>
            <DialogDescription>
              Upload the master MP3. Optionally upload a silent talking-head MP4 to auto-slice for tagged sections.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <AudioUpload file={audioFile} duration={audioDuration} onFile={handleAudio} />
            <TalkingHeadUpload
              file={thFile}
              duration={thDuration}
              tag={talkingHeadTag}
              tagInScript={tagInScript}
              onFile={handleTalkingHead}
              onTagChange={setTalkingHeadTag}
            />
          </div>
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
