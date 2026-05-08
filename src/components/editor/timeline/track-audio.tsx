"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines } from "lucide-react";
import { computeWaveformPeaks } from "@/lib/waveform";
import { useBuildState } from "@/components/build/build-state-context";
import { cn } from "@/lib/utils";

interface TrackAudioProps {
  audioFile: File | null;
  audioDuration: number | null;
  pxPerSecond: number;
}

const TRACK_HEIGHT = 56;
const BLOCK_INSET = 4;

export function TrackAudio({ audioFile, audioDuration, pxPerSecond }: TrackAudioProps) {
  const { audioSelected, setAudioSelected, setSelectedOverlayId, setSelectedSectionIndex } =
    useBuildState();
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!audioFile) {
      setPeaks(null);
      return;
    }
    let cancelled = false;
    audioFile.arrayBuffer().then((buf) => {
      if (cancelled) return;
      computeWaveformPeaks(buf, 4000).then((p) => {
        if (!cancelled) setPeaks(p);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [audioFile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !audioDuration) return;
    const blockWidth = Math.max(1, Math.floor(audioDuration * pxPerSecond));
    const heightPx = TRACK_HEIGHT - BLOCK_INSET * 2;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = blockWidth * dpr;
    canvas.height = heightPx * dpr;
    canvas.style.width = `${blockWidth}px`;
    canvas.style.height = `${heightPx}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, blockWidth, heightPx);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    // Bottom-anchored bars (CapCut style): each bar grows upward from baseline.
    const baseline = heightPx - 2;
    const maxBarHeight = heightPx - 16; // leave room for the filename label at top
    for (let x = 0; x < blockWidth; x++) {
      const t = x / blockWidth;
      const idx = Math.floor(t * peaks.length);
      const v = peaks[idx] ?? 0;
      const h = Math.max(1, v * maxBarHeight);
      ctx.fillRect(x, baseline - h, 1, h);
    }
  }, [peaks, audioDuration, pxPerSecond]);

  if (!audioFile || !audioDuration) {
    return (
      <div
        className="bg-muted/10 flex items-center px-3 text-xs text-muted-foreground"
        style={{ height: TRACK_HEIGHT }}
      >
        No audio loaded
      </div>
    );
  }

  const blockWidth = Math.max(1, Math.floor(audioDuration * pxPerSecond));

  return (
    <div className="relative bg-muted/10" style={{ height: TRACK_HEIGHT }}>
      <div
        data-audio-block
        onClick={(e) => {
          e.stopPropagation();
          setSelectedOverlayId(null);
          setSelectedSectionIndex(null);
          setAudioSelected(true);
        }}
        className={cn(
          "absolute rounded-md overflow-hidden flex flex-col bg-sky-700 border border-sky-500/60 shadow-sm cursor-pointer",
          audioSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        )}
        style={{
          left: 0,
          top: BLOCK_INSET,
          width: blockWidth,
          height: TRACK_HEIGHT - BLOCK_INSET * 2,
        }}
      >
        <div className="absolute top-0 left-0 right-0 px-2 py-0.5 flex items-center gap-1 text-[10px] text-white/90 bg-sky-900/40 z-10 truncate">
          <AudioLines className="w-3 h-3 shrink-0" />
          <span className="truncate">{audioFile.name}</span>
        </div>
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
  );
}
