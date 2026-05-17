"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBuildState } from "@/components/build/build-state-context";
import type {
  TalkingHeadKind,
  TalkingHeadLayer,
} from "@/lib/talking-head/talking-head-types";

interface Props {
  kind: TalkingHeadKind;
  existing: TalkingHeadLayer | undefined;
  onClose: () => void;
}

const KIND_LABEL: Record<TalkingHeadKind, string> = {
  full: "talking-head-full",
  overlay: "talking-head-overlay",
};

export function AddTalkingHeadDialog({ kind, existing, onClose }: Props) {
  const { addTalkingHeadLayer, removeTalkingHeadLayer } = useBuildState();
  const [file, setFile] = useState<File | null>(null);

  function handleSubmit(f: File) {
    addTalkingHeadLayer({ kind, file: f });
    onClose();
  }

  function handleRemove(layer: TalkingHeadLayer) {
    removeTalkingHeadLayer(layer.id);
    onClose();
  }

  const titlePrefix = existing ? "Replace" : "Add";
  const submitLabel = existing ? "Replace" : "Upload";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`${titlePrefix} ${KIND_LABEL[kind]}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {kind === "overlay" && (
            <p className="text-xs text-muted-foreground">
              Upload a pre-matted video (e.g. CapCut HEVC-alpha mp4). The app
              does not remove backgrounds — the file you upload is rendered
              as-is, with alpha composited server-side.
            </p>
          )}
          <DialogFooter className="gap-2">
            {existing && (
              <Button
                variant="destructive"
                onClick={() => handleRemove(existing)}
              >
                Remove
              </Button>
            )}
            <Button
              disabled={!file}
              onClick={() => file && handleSubmit(file)}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
