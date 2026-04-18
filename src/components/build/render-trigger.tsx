"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getClip } from "@/lib/clip-storage";
import type { MatchedSection } from "@/lib/auto-match";

interface RenderTriggerProps {
  audioFile: File;
  timeline: MatchedSection[];
}

export function RenderTrigger({ audioFile, timeline }: RenderTriggerProps) {
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  async function startRender() {
    setRendering(true);

    const keys = new Set(
      timeline.flatMap((s) => s.clips.filter((c) => !c.isPlaceholder).map((c) => c.indexeddbKey)),
    );
    const clips: Record<string, ArrayBuffer> = {};
    for (const key of keys) {
      const buf = await getClip(key);
      if (buf) clips[key] = buf;
    }

    const audioBuffer = await audioFile.arrayBuffer();

    const worker = new Worker(new URL("@/workers/render-worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (e) => {
      if (e.data.type === "progress") {
        setProgress({ current: e.data.currentSection, total: e.data.totalSections });
      } else if (e.data.type === "done") {
        const blob = new Blob([e.data.output], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vsl-${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
        setRendering(false);
        setProgress(null);
        worker.terminate();
      }
    };

    worker.postMessage({ timeline, audioBuffer, clips }, [
      audioBuffer,
      ...Object.values(clips),
    ]);
  }

  return (
    <div className="space-y-3">
      {progress && (
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Section {progress.current} of {progress.total}
          </p>
        </div>
      )}
      <Button onClick={startRender} disabled={rendering} className="w-full" size="lg">
        {rendering ? "Rendering…" : "Render Video"}
      </Button>
    </div>
  );
}
