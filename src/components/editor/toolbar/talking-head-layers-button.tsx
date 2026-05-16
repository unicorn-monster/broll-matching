"use client";

import { Video } from "lucide-react";
import { useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { TalkingHeadLayersDialog } from "../dialogs/talking-head-layers-dialog";

export function TalkingHeadLayersButton() {
  const { talkingHeadLayers } = useBuildState();
  const [open, setOpen] = useState(false);
  const n = talkingHeadLayers.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-background hover:bg-muted text-xs"
        title="Manage talking-head layers"
      >
        <Video className="w-3.5 h-3.5" />
        {n === 0 ? "Add talking-head" : `Talking-head: ${n}`}
      </button>
      <TalkingHeadLayersDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
