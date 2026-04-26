"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { getClip } from "@/lib/clip-storage";
import { buildSectionPlaybackPlan, type PlaybackPlan } from "@/lib/playback-plan";
import { formatMs } from "@/lib/format-time";

export function PreviewPlayer() {
  const {
    audioFile,
    timeline,
    selectedSectionIndex,
    setPlayheadMs,
  } = useBuildState();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipUrls, setClipUrls] = useState<Map<string, string>>(new Map());
  const clipUrlsRef = useRef<Map<string, string>>(new Map());
  const [chainIdx, setChainIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Revoke all accumulated clip blob URLs only on full unmount.
  useEffect(() => {
    const ref = clipUrlsRef;
    return () => {
      ref.current.forEach((u) => URL.revokeObjectURL(u));
      ref.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!timeline || selectedSectionIndex === null) return;
    const section = timeline[selectedSectionIndex];
    if (!section) return;
    let cancelled = false;
    (async () => {
      const additions = new Map<string, string>();
      for (const c of section.clips) {
        if (c.isPlaceholder) continue;
        if (clipUrlsRef.current.has(c.indexeddbKey)) continue;
        const buf = await getClip(c.indexeddbKey);
        if (cancelled || !buf) continue;
        const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
        clipUrlsRef.current.set(c.indexeddbKey, url);
        additions.set(c.indexeddbKey, url);
      }
      if (!cancelled && additions.size > 0) {
        setClipUrls((prev) => {
          const next = new Map(prev);
          additions.forEach((v, k) => next.set(k, v));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, selectedSectionIndex]);

  const plan: PlaybackPlan | null = useMemo(() => {
    if (!timeline || selectedSectionIndex === null || !audioUrl) return null;
    return buildSectionPlaybackPlan(timeline, selectedSectionIndex, audioUrl, clipUrls);
  }, [timeline, selectedSectionIndex, audioUrl, clipUrls]);

  useEffect(() => {
    if (!plan) return;
    setChainIdx(0);
    setPlaying(false);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = plan.audioStartMs / 1000;
      audio.pause();
    }
  }, [plan]);

  useEffect(() => {
    if (!plan || plan.clips.length === 0) return;
    const video = videoRef.current;
    if (!video) return;
    const clip = plan.clips[chainIdx];
    if (!clip) return;
    video.src = clip.srcUrl;
    video.playbackRate = clip.speedFactor;
    if (playing) void video.play();
  }, [plan, chainIdx, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !plan) return;
    const handler = () => {
      setPlayheadMs(audio.currentTime * 1000);
    };
    audio.addEventListener("timeupdate", handler);
    return () => audio.removeEventListener("timeupdate", handler);
  }, [plan, setPlayheadMs]);

  function handleVideoEnded() {
    if (!plan) return;
    if (chainIdx < plan.clips.length - 1) {
      setChainIdx(chainIdx + 1);
    } else {
      audioRef.current?.pause();
      setPlaying(false);
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;
    if (playing) {
      audio.pause();
      video.pause();
      setPlaying(false);
    } else {
      void audio.play();
      void video.play();
      setPlaying(true);
    }
  }

  if (!timeline || selectedSectionIndex === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Select a section in the timeline to preview.
      </div>
    );
  }

  const section = timeline[selectedSectionIndex];
  if (!section) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Section not found.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-3">
      <div
        className="bg-black rounded overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: "9 / 16", height: "calc(100% - 48px)", maxWidth: "100%" }}
      >
        {plan && plan.clips.length > 0 ? (
          <video
            ref={videoRef}
            playsInline
            muted
            onEnded={handleVideoEnded}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-xs text-muted-foreground">Black frame (no clip for [{section.tag}])</div>
        )}
      </div>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <span className="font-mono">{formatMs(section.durationMs)}</span>
        <span>· [{section.tag}]</span>
      </div>
    </div>
  );
}
