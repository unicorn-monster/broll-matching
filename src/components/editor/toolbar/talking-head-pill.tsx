"use client";

import { Video } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { cn } from "@/lib/utils";

export function TalkingHeadPill() {
  const { talkingHeadFile, talkingHeadTag, setTalkingHeadDialogOpen } = useBuildState();
  const ready = !!talkingHeadFile;

  return (
    <button
      type="button"
      onClick={() => setTalkingHeadDialogOpen(true)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition",
        ready
          ? "bg-purple-500/10 border-purple-500/40 text-purple-300 hover:bg-purple-500/20"
          : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      <Video className="w-3 h-3" />
      {ready ? `TH: ${talkingHeadTag}` : "Talking-head: not set"}
    </button>
  );
}
