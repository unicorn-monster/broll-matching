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

// Length threshold (in seconds) above which we warn that matting will take
// a long time before kicking off the worker. 5 minutes is a rough heuristic
// derived from the WebCodecs-based encoder throughput on consumer hardware.
const LENGTH_WARN_SEC = 300;

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
  const { addTalkingHeadLayer, removeTalkingHeadLayer, abortMatting } =
    useBuildState();
  const [file, setFile] = useState<File | null>(null);
  // When non-null we're showing the >5min confirmation screen with the file
  // ready to commit on user approval. Cancel returns to the picker.
  const [pendingConfirm, setPendingConfirm] = useState<File | null>(null);

  async function handleSubmit(f: File) {
    // Only overlay layers go through matting — full layers play the original
    // file unchanged, so duration doesn't gate them.
    if (kind === "overlay" && !pendingConfirm) {
      const dur = await probeDurationSec(f);
      if (dur > LENGTH_WARN_SEC) {
        setPendingConfirm(f);
        return;
      }
    }
    addTalkingHeadLayer({ kind, file: f });
    onClose();
  }

  function handleRemove(layer: TalkingHeadLayer) {
    // For an in-flight overlay matting job we must abort (which also drops
    // the layer + cached blobs); for any other state plain removal is enough.
    if (kind === "overlay" && layer.mattingStatus === "processing") {
      abortMatting(layer.id);
    } else {
      removeTalkingHeadLayer(layer.id);
    }
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

        {pendingConfirm ? (
          <div className="space-y-3">
            <p className="text-sm">
              Video dài hơn 5 phút. Matting có thể mất 15+ phút. Tiếp tục?
            </p>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setPendingConfirm(null)}
              >
                Hủy
              </Button>
              <Button onClick={() => void handleSubmit(pendingConfirm)}>
                Tiếp tục
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              type="file"
              accept="video/mp4"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
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
                onClick={() => file && void handleSubmit(file)}
              >
                {submitLabel}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Probe an MP4's duration via a hidden <video> element. Used only on the
 *  client (component is `"use client"`), so no SSR concerns. */
function probeDurationSec(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.src = url;
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("probe failed"));
    };
  });
}
