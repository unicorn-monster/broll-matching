"use client";

import { Plus, Video } from "lucide-react";
import { useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { AddTalkingHeadDialog } from "../dialogs/add-talking-head-dialog";

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
        title="Add a new talking-head layer"
      >
        <Plus className="w-3.5 h-3.5" />
        <Video className="w-3.5 h-3.5" />
        Add talking-head
        {n > 0 && <span className="text-muted-foreground">({n})</span>}
      </button>
      <AddTalkingHeadDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
