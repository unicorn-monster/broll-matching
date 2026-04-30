"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getClip } from "@/lib/clip-storage";
import type { MatchedSection } from "@/lib/auto-match";

interface RenderTriggerProps {
  audioFile: File;
  timeline: MatchedSection[];
}

type Stage = "loading" | "rendering";

const LOAD_TIMEOUT_MS = 60_000;

export function RenderTrigger({ audioFile, timeline }: RenderTriggerProps) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [progress, setProgress] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engineReadyRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("@/workers/render-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "loaded") {
        engineReadyRef.current = true;
        setEngineReady(true);
      } else if (d.type === "stage") {
        setStage(d.stage);
        if (d.stage === "rendering") setProgress(0);
      } else if (d.type === "progress") {
        setProgress(d.overall);
      } else if (d.type === "log") {
        console.log("[ffmpeg]", d.message);
      } else if (d.type === "load-error") {
        console.error("[render] load-error:", d.message);
        setError(`Failed to load render engine: ${d.message}. Open DevTools Console for details.`);
        setRendering(false);
        setStage(null);
      } else if (d.type === "render-error") {
        console.error("[render] render-error:", d.message);
        setError(`Render failed: ${d.message}. Open DevTools Console for details.`);
        setRendering(false);
        setStage(null);
      } else if (d.type === "done") {
        const blob = new Blob([d.output], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vsl-${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
        setRendering(false);
        setStage(null);
        setProgress(0);
      }
    };

    worker.onerror = (ev) => {
      console.error("[render-worker] onerror:", ev.message, ev.filename, ev.lineno);
      setError(`Worker error: ${ev.message || "unknown"}. Open DevTools Console for details.`);
      setRendering(false);
      setStage(null);
    };

    worker.postMessage({ cmd: "load", baseURL: `${window.location.origin}/ffmpeg` });

    const loadTimeout = setTimeout(() => {
      if (!engineReadyRef.current) {
        setError(
          `Render engine did not load within ${LOAD_TIMEOUT_MS / 1000}s. Open DevTools Console + Network tab for details.`,
        );
      }
    }, LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(loadTimeout);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!rendering) return;
    startedAtRef.current = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [rendering]);

  async function startRender() {
    const worker = workerRef.current;
    if (!worker) return;

    setError(null);
    setRendering(true);
    setStage(engineReady ? "rendering" : "loading");
    setProgress(0);

    const keys = new Set(
      timeline.flatMap((s) => s.clips.filter((c) => !c.isPlaceholder).map((c) => c.fileId)),
    );
    const clips: Record<string, ArrayBuffer> = {};
    for (const key of keys) {
      const buf = await getClip(key);
      if (buf) clips[key] = buf;
    }

    const audioBuffer = await audioFile.arrayBuffer();

    worker.postMessage({ cmd: "render", timeline, audioBuffer, clips }, [
      audioBuffer,
      ...Object.values(clips),
    ]);
  }

  const label = stage === "loading" ? "Loading render engine…" : "Rendering video…";
  const pct = Math.round(progress * 100);
  const showBar = stage === "rendering";

  return (
    <div className="space-y-3">
      {!rendering && !engineReady && !error && (
        <p className="text-xs text-muted-foreground">Preparing render engine in background…</p>
      )}
      {error && (
        <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>
      )}
      {rendering && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{label}</span>
            <span className="tabular-nums">{formatElapsed(elapsedSec)}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={
                showBar
                  ? "h-full bg-primary transition-[width] duration-150"
                  : "h-full bg-primary/40 animate-pulse w-1/3"
              }
              style={showBar ? { width: `${pct}%` } : undefined}
            />
          </div>
          {showBar && (
            <p className="text-xs text-muted-foreground text-center tabular-nums">{pct}%</p>
          )}
        </div>
      )}
      <Button onClick={startRender} disabled={rendering} className="w-full" size="lg">
        {rendering ? "Rendering…" : "Render Video"}
      </Button>
    </div>
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
