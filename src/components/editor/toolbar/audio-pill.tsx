"use client";

import { Music } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPill() {
  const { audioFile, audioDuration, setAudioDialogOpen } = useBuildState();
  const ready = !!audioFile && audioDuration !== null;

  return (
    <button
      type="button"
      onClick={() => setAudioDialogOpen(true)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition",
        ready
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
          : "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <Music className="w-3 h-3" />
      {ready ? formatDuration(audioDuration!) : "Audio: not set"}
    </button>
  );
}
