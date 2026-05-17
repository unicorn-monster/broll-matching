"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { getLayerByKind } from "@/lib/talking-head/talking-head-store";

/** Live progress / abort UI for the in-flight overlay matting job. Auto-closes itself
 *  as soon as the layer leaves the `processing` state (done, failed, or removed), so
 *  callers only need to track when to OPEN it. */
export function MattingProgressModal({ onClose }: { onClose: () => void }) {
  const { talkingHeadLayers, abortMatting } = useBuildState();
  const layer = getLayerByKind(talkingHeadLayers, "overlay");
  // Capture mount time once so ETA math doesn't reset every render (or whenever the
  // user reopens the modal); this is wall-clock-elapsed, not job-elapsed, which is
  // good enough for a coarse "~N phút" estimate.
  const [startedAt] = useState(() => Date.now());

  // Auto-close when matting transitions out of `processing` (done/failed/aborted).
  useEffect(() => {
    if (!layer || layer.mattingStatus !== "processing") onClose();
  }, [layer, onClose]);

  if (!layer || layer.mattingStatus !== "processing") return null;

  const p = layer.mattingProgress ?? { framesDone: 0, totalFrames: 1 };
  const pct = Math.round((p.framesDone / Math.max(p.totalFrames, 1)) * 100);
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const etaSec =
    p.framesDone > 0
      ? Math.round((elapsedSec * (p.totalFrames - p.framesDone)) / p.framesDone)
      : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đang tách nền talking-head-overlay</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="h-2 bg-muted rounded overflow-hidden">
            <div className="h-full bg-yellow-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">
            {p.framesDone.toLocaleString()} / {p.totalFrames.toLocaleString()} frames ({pct}%)
            {etaSec > 0 && ` — còn ~${Math.ceil(etaSec / 60)} phút`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              abortMatting(layer.id);
              onClose();
            }}
          >
            Hủy matting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
