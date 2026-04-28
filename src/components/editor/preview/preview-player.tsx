"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { getClip } from "@/lib/clip-storage";
import {
  buildFullTimelinePlaybackPlan,
  findClipAtMs,
  findSectionAtMs,
  clipIdentityKey,
} from "@/lib/playback-plan";

import { formatMs } from "@/lib/format-time";

function setVideoSrcIfChanged(video: HTMLVideoElement, url: string) {
  if (video.src === url || video.currentSrc === url) return;
  video.src = url;
}

export function PreviewPlayer() {
  const {
    audioFile,
    timeline,
    selectedSectionIndex,
    setSelectedSectionIndex,
    setPlayheadMs,
    playerSeekRef,
    previewClipKey,
  } = useBuildState();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipUrls, setClipUrls] = useState<Map<string, string>>(new Map());
  const clipUrlsRef = useRef<Map<string, string>>(new Map());
  const [playing, setPlaying] = useState(false);
  const currentClipKeyRef = useRef<string | null>(null);
  const selectedSectionRef = useRef<number | null>(selectedSectionIndex);
  selectedSectionRef.current = selectedSectionIndex;

  // Audio object URL.
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Revoke clip blob URLs only on full unmount.
  useEffect(() => {
    const ref = clipUrlsRef;
    return () => {
      ref.current.forEach((u) => URL.revokeObjectURL(u));
      ref.current.clear();
    };
  }, []);

  // Eager pre-fetch every real clip the moment timeline is set so playback
  // never stalls on an IndexedDB read mid-scrub.
  useEffect(() => {
    if (!timeline) return;
    let cancelled = false;
    (async () => {
      const additions = new Map<string, string>();
      for (const section of timeline) {
        for (const c of section.clips) {
          if (c.isPlaceholder) continue;
          if (clipUrlsRef.current.has(c.indexeddbKey)) continue;
          const buf = await getClip(c.indexeddbKey);
          if (cancelled || !buf) continue;
          const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
          clipUrlsRef.current.set(c.indexeddbKey, url);
          additions.set(c.indexeddbKey, url);
        }
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
  }, [timeline]);

  const plan = useMemo(() => {
    if (!timeline || !audioUrl) return null;
    return buildFullTimelinePlaybackPlan(timeline, audioUrl, clipUrls);
  }, [timeline, audioUrl, clipUrls]);

  // Imperatively swap <video> src to the clip that should be on screen at
  // audioMs. Idempotent — bails when the same clip is already loaded so
  // setting currentTime mid-clip is a cheap no-op.
  const ensureClipLoaded = useCallback(
    (audioMs: number) => {
      const video = videoRef.current;
      if (!video || !plan) return;
      const clip = findClipAtMs(plan.clips, audioMs);
      const nextKey = clip ? clipIdentityKey(clip) : null;
      if (currentClipKeyRef.current === nextKey) return;
      currentClipKeyRef.current = nextKey;
      if (!clip) {
        video.removeAttribute("src");
        video.load();
        return;
      }
      setVideoSrcIfChanged(video, clip.srcUrl);
      video.playbackRate = clip.speedFactor;
      const offsetSec = ((audioMs - clip.startMs) * clip.speedFactor) / 1000;
      const seekWhenReady = () => {
        try {
          video.currentTime = Math.max(0, offsetSec);
        } catch {
          // ignore seek errors — currentTime can throw if metadata not yet ready
        }
        if (audioRef.current && !audioRef.current.paused) void video.play();
      };
      if (video.readyState >= 1) seekWhenReady();
      else video.addEventListener("loadedmetadata", seekWhenReady, { once: true });
    },
    [plan],
  );

  // Register seek dispatcher for the timeline.
  useEffect(() => {
    playerSeekRef.current = (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = Math.max(0, ms / 1000);
      setPlayheadMs(ms);
      ensureClipLoaded(ms);
    };
    return () => {
      playerSeekRef.current = null;
    };
  }, [ensureClipLoaded, playerSeekRef, setPlayheadMs]);

  // rAF loop: drives playhead, swap detection, and section selection from
  // audio.currentTime while playing.
  useEffect(() => {
    if (!playing || !plan || !timeline) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const audioMs = audio.currentTime * 1000;
      setPlayheadMs(audioMs);
      ensureClipLoaded(audioMs);
      const sectionIdx = findSectionAtMs(timeline, audioMs);
      if (sectionIdx !== null && sectionIdx !== selectedSectionRef.current) {
        selectedSectionRef.current = sectionIdx;
        setSelectedSectionIndex(sectionIdx);
      }
      if (audio.ended) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, plan, timeline, ensureClipLoaded, setPlayheadMs, setSelectedSectionIndex]);

  // When user clicks a section in the timeline (sets selectedSectionIndex
  // directly, not via the rAF loop), seek the audio to that section's start.
  useEffect(() => {
    if (selectedSectionIndex === null || !timeline || !plan) return;
    const audio = audioRef.current;
    if (!audio) return;
    let cursor = 0;
    for (let i = 0; i < selectedSectionIndex; i++) cursor += timeline[i]!.durationMs;
    // Avoid feedback: only seek when the audio is more than 100ms away from
    // this section's start. Otherwise the rAF loop's own selection update
    // would re-trigger a seek.
    if (Math.abs(audio.currentTime * 1000 - cursor) > 100) {
      audio.currentTime = cursor / 1000;
      setPlayheadMs(cursor);
      ensureClipLoaded(cursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionIndex]);

  // Drive the preview <video> when previewClipKey is set: pause timeline,
  // load broll, auto-play once, stop at end frame.
  useEffect(() => {
    const previewVideo = previewVideoRef.current;
    if (!previewVideo) return;

    if (previewClipKey === null) {
      previewVideo.pause();
      return;
    }

    const audio = audioRef.current;
    const timelineVideo = videoRef.current;
    if (audio && !audio.paused) audio.pause();
    if (timelineVideo && !timelineVideo.paused) timelineVideo.pause();

    let cancelled = false;
    (async () => {
      let url = clipUrlsRef.current.get(previewClipKey);
      if (!url) {
        const buf = await getClip(previewClipKey);
        if (cancelled || !buf) return;
        url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
        clipUrlsRef.current.set(previewClipKey, url);
      }
      if (cancelled) return;
      if (previewVideo.src !== url && previewVideo.currentSrc !== url) {
        previewVideo.src = url;
      }
      previewVideo.muted = false;
      previewVideo.playbackRate = 1;
      previewVideo.currentTime = 0;
      void previewVideo.play();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewClipKey]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      ensureClipLoaded(audio.currentTime * 1000);
      void audio.play();
      void videoRef.current?.play();
      setPlaying(true);
    }
  }

  const totalMs = timeline?.reduce((s, x) => s + x.durationMs, 0) ?? 0;
  const playheadSection =
    timeline && selectedSectionIndex !== null ? timeline[selectedSectionIndex] : null;
  const showTimeline = previewClipKey === null;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-3">
      <div
        className="bg-black rounded overflow-hidden flex items-center justify-center relative"
        style={{ aspectRatio: "4 / 5", height: "calc(100% - 48px)", maxWidth: "100%" }}
      >
        {/* Timeline placeholder — shown when no audio and not in broll preview */}
        {!audioFile && showTimeline && (
          <span className="text-sm text-muted-foreground absolute">Set audio in the toolbar to begin.</span>
        )}
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ display: showTimeline ? "block" : "none" }}
        />
        <video
          ref={previewVideoRef}
          playsInline
          className="w-full h-full object-cover absolute inset-0"
          style={{ display: previewClipKey === null ? "none" : "block" }}
        />
      </div>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      {audioFile && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {showTimeline && (
            <button
              type="button"
              onClick={togglePlay}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
          )}
          <span className="font-mono">
            {formatMs((audioRef.current?.currentTime ?? 0) * 1000)} / {formatMs(totalMs)}
          </span>
          {playheadSection && <span>· [{playheadSection.tag}]</span>}
        </div>
      )}
    </div>
  );
}
