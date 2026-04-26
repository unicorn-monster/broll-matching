"use client";

import { useEffect, useRef, useState } from "react";
import { computeWaveformPeaks } from "@/lib/waveform";

interface TrackAudioProps {
  audioFile: File | null;
  audioDuration: number | null;
  pxPerSecond: number;
}

export function TrackAudio({ audioFile, audioDuration, pxPerSecond }: TrackAudioProps) {
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
    const widthPx = Math.max(1, Math.floor(audioDuration * pxPerSecond));
    const heightPx = 50;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthPx * dpr;
    canvas.height = heightPx * dpr;
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = "rgba(96, 165, 250, 0.6)";
    const mid = heightPx / 2;
    for (let x = 0; x < widthPx; x++) {
      const t = x / widthPx;
      const idx = Math.floor(t * peaks.length);
      const v = peaks[idx] ?? 0;
      const h = Math.max(1, v * (heightPx - 4));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, audioDuration, pxPerSecond]);

  if (!audioFile || !audioDuration) {
    return (
      <div className="h-[50px] bg-muted/10 flex items-center px-3 text-xs text-muted-foreground">
        No audio loaded
      </div>
    );
  }

  return (
    <div className="h-[50px] bg-muted/5 overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
