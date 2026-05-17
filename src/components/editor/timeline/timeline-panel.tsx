"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Minus, Play, Pause } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { formatMs } from "@/lib/format-time";
import { TimelineRuler } from "./timeline-ruler";
import { TrackTags } from "./track-tags";
import { TrackClips } from "./track-clips";
import { TrackAudio } from "./track-audio";
import { TrackTextOverlays } from "./track-text-overlays";
import { TrackTalkingHeadLayers } from "./track-talking-head-layers";
import { TrackOverlayShots } from "./track-overlay-shots";
import { OverlayTracks } from "../overlay/overlay-tracks";
import { useAudioKeyboard } from "../audio/use-audio-keyboard";

const MIN_PX_PER_SEC = 5;
const MAX_PX_PER_SEC = 200;

export function TimelinePanel() {
  useAudioKeyboard();
  const {
    timeline,
    audioFile,
    audioDuration,
    selectedSectionIndex,
    setSelectedSectionIndex,
    toggleSectionLock,
    playheadMs,
    playerSeekRef,
    isPlaying,
    playerTogglePlayRef,
    overlays,
    setAudioSelected,
  } = useBuildState();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [pxPerSec, setPxPerSec] = useState<number | null>(null);

  const overlaysMaxMs = useMemo(
    () => overlays.reduce((m, o) => Math.max(m, o.startMs + o.durationMs), 0),
    [overlays],
  );

  const totalMs = useMemo(() => {
    const audioMs = audioDuration ? audioDuration * 1000 : 0;
    return Math.max(audioMs, overlaysMaxMs);
  }, [audioDuration, overlaysMaxMs]);

  const effectivePxPerSec = pxPerSec ?? (() => {
    if (totalMs <= 0) return 30;
    const viewport = scrollerRef.current?.clientWidth ?? 800;
    return Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, viewport / (totalMs / 1000)));
  })();

  function zoom(delta: number) {
    setPxPerSec((curr) => {
      const base = curr ?? effectivePxPerSec;
      return Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, base * delta));
    });
  }

  const playheadLeft = (playheadMs / 1000) * effectivePxPerSec;
  const renderMs = totalMs > 0 ? totalMs : 60_000;
  const totalWidthPx = (renderMs / 1000) * effectivePxPerSec;

  function handleScrubClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button,[data-clip-block],[data-overlay-block],[data-audio-block]")) return;
    setAudioSelected(false);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = (x / effectivePxPerSec) * 1000;
    playerSeekRef.current?.(Math.max(0, ms));
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-muted/20 text-xs">
        {audioFile && (
          <button
            type="button"
            onClick={() => playerTogglePlayRef.current?.()}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
        )}
        <span className="font-mono text-muted-foreground">
          {formatMs(playheadMs)} / {formatMs(totalMs)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => zoom(0.8)} className="p-1 hover:bg-muted rounded" aria-label="Zoom out">
            <Minus className="w-3 h-3" />
          </button>
          <button onClick={() => zoom(1.25)} className="p-1 hover:bg-muted rounded" aria-label="Zoom in">
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="relative flex-1 overflow-x-auto overflow-y-hidden">
        <div
          style={{ width: `${Math.max(totalWidthPx, 1)}px` }}
          className="relative cursor-pointer"
          onClick={handleScrubClick}
        >
          <TimelineRuler totalMs={renderMs} pxPerSecond={effectivePxPerSec} />
          <TrackTextOverlays pxPerSecond={effectivePxPerSec} />
          {timeline ? (
            <>
              <TrackTags
                timeline={timeline}
                pxPerSecond={effectivePxPerSec}
                selectedIndex={selectedSectionIndex}
                onSelect={setSelectedSectionIndex}
                onToggleLock={toggleSectionLock}
              />
              <OverlayTracks pxPerSecond={effectivePxPerSec} />
              <TrackOverlayShots pxPerSecond={effectivePxPerSec} />
              <TrackTalkingHeadLayers pxPerSecond={effectivePxPerSec} />
              <TrackClips
                timeline={timeline}
                pxPerSecond={effectivePxPerSec}
                selectedIndex={selectedSectionIndex}
                onSelect={setSelectedSectionIndex}
              />
            </>
          ) : (
            <div className="h-[130px] flex items-center px-3 text-xs text-muted-foreground">
              Paste script in the toolbar to populate sections.
            </div>
          )}
          {audioFile ? (
            <TrackAudio audioFile={audioFile} audioDuration={audioDuration} pxPerSecond={effectivePxPerSec} />
          ) : (
            <div className="h-[56px] flex items-center px-3 text-xs text-muted-foreground bg-muted/10">
              No audio loaded
            </div>
          )}

          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-orange-400 shadow-[0_0_4px_rgba(251,146,60,0.8)]"
            style={{ left: `${playheadLeft}px` }}
          />
        </div>
      </div>
    </div>
  );
}
