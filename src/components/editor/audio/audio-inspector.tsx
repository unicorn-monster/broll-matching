"use client";

import { Trash2, AudioLines } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { formatMs } from "@/lib/format-time";

export function AudioInspector() {
  const { audioFile, audioDuration, setAudio, setAudioSelected, setIsPlaying } = useBuildState();

  if (!audioFile) return null;

  function onDelete() {
    setIsPlaying(false);
    setAudio(null, null);
    setAudioSelected(false);
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-3 text-xs gap-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <div className="w-12 h-12 bg-sky-900/40 rounded flex items-center justify-center flex-shrink-0">
          <AudioLines className="w-5 h-5 text-sky-300" />
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">{audioFile.name}</div>
          <div className="text-muted-foreground text-[10px]">Master audio track</div>
        </div>
      </div>

      <div className="space-y-0.5 text-muted-foreground">
        <div className="flex justify-between">
          <span>Duration</span>
          <span className="font-mono">
            {audioDuration ? formatMs(audioDuration * 1000) : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Size</span>
          <span className="font-mono">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span>
        </div>
        <div className="flex justify-between">
          <span>Type</span>
          <span className="font-mono truncate">{audioFile.type || "audio"}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto w-full flex items-center justify-center gap-1 py-1.5 text-red-400 hover:bg-red-500/10 rounded border border-red-500/30"
      >
        <Trash2 className="w-3 h-3" />
        Delete audio
      </button>
    </div>
  );
}
