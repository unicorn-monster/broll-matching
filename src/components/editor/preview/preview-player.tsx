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
    playheadMs,
    setPlayheadMs,
    playerSeekRef,
    previewClipKey,
    isPlaying,
    setIsPlaying,
    playerTogglePlayRef,
  } = useBuildState();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [clipUrls, setClipUrls] = useState<Map<string, string>>(new Map());
  const clipUrlsRef = useRef<Map<string, string>>(new Map());
  const currentClipKeyRef = useRef<string | null>(null);
  const selectedSectionRef = useRef<number | null>(selectedSectionIndex);
  selectedSectionRef.current = selectedSectionIndex;

  const [brollPlaying, setBrollPlaying] = useState(false);
  const [brollCurrentMs, setBrollCurrentMs] = useState(0);
  const [brollDurationMs, setBrollDurationMs] = useState(0);

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
    if (!isPlaying || !plan || !timeline) return;
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
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, plan, timeline, ensureClipLoaded, setPlayheadMs, setSelectedSectionIndex]);

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

  // Sync broll preview video state into React so controls can render.
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v) return;
    function onTimeUpdate() {
      if (v) setBrollCurrentMs(v.currentTime * 1000);
    }
    function onLoadedMetadata() {
      if (v) setBrollDurationMs(v.duration * 1000);
    }
    function onPlay() {
      setBrollPlaying(true);
    }
    function onPause() {
      setBrollPlaying(false);
    }
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, []);

  function toggleBrollPlay() {
    const v = previewVideoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended || v.currentTime >= v.duration - 0.05) v.currentTime = 0;
      void v.play();
    } else {
      v.pause();
    }
  }

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
      previewVideo.muted = true;
      previewVideo.playbackRate = 1;
      previewVideo.currentTime = 0;
      void previewVideo.play();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewClipKey]);

  // Space bar: play/pause for both timeline and broll preview mode.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      if (previewClipKey !== null) {
        const pv = previewVideoRef.current;
        if (!pv) return;
        pv.paused ? void pv.play() : pv.pause();
      } else {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
          ensureClipLoaded(audio.currentTime * 1000);
          void audio.play();
          void videoRef.current?.play();
          setIsPlaying(true);
        } else {
          audio.pause();
          videoRef.current?.pause();
          setIsPlaying(false);
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [previewClipKey, ensureClipLoaded]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      videoRef.current?.pause();
      setIsPlaying(false);
    } else {
      ensureClipLoaded(audio.currentTime * 1000);
      void audio.play();
      void videoRef.current?.play();
      setIsPlaying(true);
    }
  }

  useEffect(() => {
    playerTogglePlayRef.current = togglePlay;
  });

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
          data-broll-preview
          className="w-full h-full object-cover absolute inset-0"
          style={{ display: previewClipKey === null ? "none" : "block" }}
        />
      </div>
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      {previewClipKey !== null ? (
        <div data-broll-preview className="flex items-center gap-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={toggleBrollPlay}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label={brollPlaying ? "Pause" : "Play"}
          >
            {brollPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <span className="font-mono">
            {formatMs(brollCurrentMs)} / {formatMs(brollDurationMs)}
          </span>
        </div>
      ) : audioFile ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={togglePlay}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <span className="font-mono">
            {formatMs(playheadMs)} / {formatMs(totalMs)}
          </span>
          {playheadSection && <span>· [{playheadSection.tag}]</span>}
        </div>
      ) : null}
    </div>
  );
}
