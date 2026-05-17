"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { useMediaPool } from "@/state/media-pool";
import {
  buildFullTimelinePlaybackPlan,
  findClipAtMs,
  findSectionAtMs,
  clipIdentityKey,
} from "@/lib/playback-plan";
import { findActiveOverlays, findTopmostActive, computeFadedVolume } from "@/lib/overlay/overlay-render-plan";
import { sectionKey } from "@/lib/matting/section-key";
import { OVERLAY_PADDING_PX, OVERLAY_WIDTH_RATIO } from "@/lib/render-segments";

import { formatMs } from "@/lib/format-time";
import { TextOverlayLayer } from "./text-overlay-layer";

function setVideoSrcIfChanged(video: HTMLVideoElement, url: string) {
  if (video.src === url || video.currentSrc === url) return;
  video.src = url;
}

export function PreviewPlayer() {
  const {
    audioFile,
    talkingHeadFiles,
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
    overlays,
    disabledOverlayShots,
  } = useBuildState();

  const mediaPool = useMediaPool();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const overlayVideoRefs = useRef<Map<string, HTMLVideoElement | null>>(new Map());
  // Single <video> for the talking-head matted webm. We reuse one element across
  // sections (re-pointing src as the active section changes) rather than rendering
  // one per layer — the editor model only allows a single 'overlay' layer at a time.
  // VP9 alpha requires Chromium; non-Chromium browsers will draw it opaque.
  const mattedOverlayVideoRef = useRef<HTMLVideoElement | null>(null);
  const mattedOverlayCurrentFileIdRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!previewFrameRef.current) return;
    const el = previewFrameRef.current;
    const ro = new ResizeObserver(() => {
      setFrameSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setFrameSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
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

  // Per-layer talking-head blob URLs, keyed by the layer's fileId. Recomputed whenever
  // the set of files changes; previous URLs are revoked on cleanup to avoid leaks.
  const [thUrls, setThUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const [fileId, file] of talkingHeadFiles) {
      next.set(fileId, URL.createObjectURL(file));
    }
    setThUrls(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
  }, [talkingHeadFiles]);

  // Populate clip URL cache from mediaPool (synchronous — no IndexedDB read).
  useEffect(() => {
    const additions = new Map<string, string>();
    if (timeline) {
      for (const section of timeline) {
        for (const c of section.clips) {
          if (c.isPlaceholder) continue;
          if (clipUrlsRef.current.has(c.fileId)) continue;
          const url = mediaPool.getFileURL(c.fileId);
          if (!url) continue;
          clipUrlsRef.current.set(c.fileId, url);
          additions.set(c.fileId, url);
        }
      }
    }
    for (const o of overlays) {
      if (o.kind !== "broll-video") continue;
      if (clipUrlsRef.current.has(o.fileId)) continue;
      const url = mediaPool.getFileURL(o.fileId);
      if (!url) continue;
      clipUrlsRef.current.set(o.fileId, url);
      additions.set(o.fileId, url);
    }
    // Sync per-layer talking-head URLs into the playback-plan cache. Each TH layer's
    // fileId is unique (prefixed `__th_layer__`) so it cannot collide with media-pool ids.
    // Stale layer ids are pruned so a removed layer's URL doesn't linger in the cache.
    const removalsForState: string[] = [];
    for (const [fileId] of clipUrlsRef.current) {
      if (fileId.startsWith("__th_layer__") && !thUrls.has(fileId)) {
        clipUrlsRef.current.delete(fileId);
        removalsForState.push(fileId);
      }
    }
    for (const [fileId, url] of thUrls) {
      if (clipUrlsRef.current.get(fileId) !== url) {
        clipUrlsRef.current.set(fileId, url);
        additions.set(fileId, url);
      }
    }
    if (removalsForState.length > 0) {
      setClipUrls((prev) => {
        const next = new Map(prev);
        for (const k of removalsForState) next.delete(k);
        return next;
      });
    }

    if (additions.size > 0) {
      setClipUrls((prev) => {
        const next = new Map(prev);
        additions.forEach((v, k) => next.set(k, v));
        return next;
      });
    }
  }, [timeline, overlays, mediaPool, thUrls]);

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
      // For talking-head clips, sourceSeekMs is the absolute position within
      // the source MP4 where this clip starts. local is the ms elapsed since
      // the clip slot began (clamped to 0 to guard against sub-ms rAF drift).
      const local = Math.max(0, audioMs - clip.startMs);
      const offsetSec = clip.sourceSeekMs !== undefined
        ? (clip.sourceSeekMs + local) / 1000
        : (local * clip.speedFactor) / 1000;
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

  const ensureOverlaysLoaded = useCallback(
    (audioMs: number) => {
      const audio = audioRef.current;
      const audioPlaying = audio !== null && !audio.paused;

      const active = findActiveOverlays(overlays, audioMs);
      const topmost = findTopmostActive(overlays, audioMs);
      const activeIds = new Set(active.map((o) => o.id));

      for (const o of overlays) {
        const el = overlayVideoRefs.current.get(o.id);
        if (!el) continue;

        if (!activeIds.has(o.id)) {
          if (!el.paused) el.pause();
          el.style.display = "none";
          continue;
        }

        if (o.kind !== "broll-video") continue;

        const url = clipUrlsRef.current.get(o.fileId);
        if (!url) continue;
        if (el.src !== url && el.currentSrc !== url) el.src = url;

        const targetSec = (audioMs - o.startMs + o.sourceStartMs) / 1000;
        if (Math.abs(el.currentTime - targetSec) > 0.1) {
          try {
            el.currentTime = Math.max(0, targetSec);
          } catch {
            // metadata not ready yet
          }
        }

        el.volume = computeFadedVolume(o, audioMs);
        el.muted = o.muted;
        el.style.display = topmost && o.id === topmost.id ? "block" : "none";

        if (audioPlaying && el.paused) void el.play();
        else if (!audioPlaying && !el.paused) el.pause();
      }
    },
    [overlays],
  );

  // Mirrors the per-frame matted overlay draw described in the talking-head spec.
  // Because the existing preview composes layers via stacked DOM <video> elements
  // (not a canvas drawImage compositor), we adapt by reusing a single positioned
  // <video> element and toggling its src/visibility per active section.
  const ensureMattedOverlayLoaded = useCallback(
    (audioMs: number) => {
      const vid = mattedOverlayVideoRef.current;
      if (!vid || !timeline) return;
      const audio = audioRef.current;
      const audioPlaying = audio !== null && !audio.paused;

      const sectionIdx = findSectionAtMs(timeline, audioMs);
      const section = sectionIdx !== null ? timeline[sectionIdx] : null;
      const overlayClip = section?.overlayClip;
      const isDisabled = section
        ? disabledOverlayShots.has(sectionKey({ startMs: section.startMs, endMs: section.endMs }))
        : false;

      // Either no overlay configured for this section, the user disabled this shot,
      // or matting hasn't produced a fileId yet — hide the element and bail.
      const url = overlayClip ? clipUrlsRef.current.get(overlayClip.fileId) : undefined;
      if (!section || !overlayClip || isDisabled || !url) {
        if (!vid.paused) vid.pause();
        vid.style.display = "none";
        mattedOverlayCurrentFileIdRef.current = null;
        return;
      }

      // Re-point src when the active overlay file changes (different layer / replaced).
      if (mattedOverlayCurrentFileIdRef.current !== overlayClip.fileId) {
        if (vid.src !== url && vid.currentSrc !== url) vid.src = url;
        mattedOverlayCurrentFileIdRef.current = overlayClip.fileId;
      }

      vid.style.display = "block";

      // Per the spec: desiredTime = (sourceSeekMs + local) / 1000, where local is
      // ms elapsed since the section's start. sourceSeekMs is the absolute position
      // in the matted webm corresponding to this section's audio window.
      const seekMs = overlayClip.sourceSeekMs ?? section.startMs;
      const local = Math.max(0, audioMs - section.startMs);
      const desiredTime = (seekMs + local) / 1000;
      if (vid.readyState >= 2 && Math.abs(vid.currentTime - desiredTime) > 0.05) {
        try {
          vid.currentTime = Math.max(0, desiredTime);
        } catch {
          // metadata may not be ready yet — next tick will retry
        }
      }

      if (audioPlaying && vid.paused) void vid.play();
      else if (!audioPlaying && !vid.paused) vid.pause();
    },
    [timeline, disabledOverlayShots],
  );

  // Register seek dispatcher for the timeline.
  useEffect(() => {
    playerSeekRef.current = (ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = Math.max(0, ms / 1000);
      setPlayheadMs(ms);
      ensureClipLoaded(ms);
      ensureOverlaysLoaded(ms);
      ensureMattedOverlayLoaded(ms);
    };
    return () => {
      playerSeekRef.current = null;
    };
  }, [ensureClipLoaded, ensureOverlaysLoaded, ensureMattedOverlayLoaded, playerSeekRef, setPlayheadMs]);

  // rAF loop: drives playhead, swap detection, and section selection from
  // audio.currentTime while playing.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const audioMs = audio.currentTime * 1000;
      setPlayheadMs(audioMs);
      ensureClipLoaded(audioMs);
      ensureOverlaysLoaded(audioMs);
      ensureMattedOverlayLoaded(audioMs);
      if (timeline) {
        const sectionIdx = findSectionAtMs(timeline, audioMs);
        if (sectionIdx !== null && sectionIdx !== selectedSectionRef.current) {
          selectedSectionRef.current = sectionIdx;
          setSelectedSectionIndex(sectionIdx);
        }
      }
      if (audio.ended) {
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, plan, timeline, ensureClipLoaded, ensureOverlaysLoaded, ensureMattedOverlayLoaded, setPlayheadMs, setSelectedSectionIndex]);

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
      ensureOverlaysLoaded(cursor);
      ensureMattedOverlayLoaded(cursor);
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
    (() => {
      let url = clipUrlsRef.current.get(previewClipKey);
      if (!url) {
        url = mediaPool.getFileURL(previewClipKey) ?? undefined;
        if (!url) return;
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
        ref={previewFrameRef}
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
        {overlays.map((o) => (
          <video
            key={o.id}
            ref={(el) => {
              overlayVideoRefs.current.set(o.id, el);
            }}
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ zIndex: o.trackIndex + 10, display: "none" }}
          />
        ))}
        {/* Talking-head matted overlay (PIP). Sized to OVERLAY_WIDTH_RATIO of the
            preview frame width; padding is scaled proportionally from the renderer's
            reference base (OVERLAY_PADDING_PX out of an assumed 1080px source width).
            object-contain preserves the matted webm's intrinsic aspect ratio so the
            element grows/shrinks vertically with the source — same behaviour as the
            ffmpeg overlay filter at render time. */}
        <video
          ref={mattedOverlayVideoRef}
          playsInline
          muted
          className="absolute object-contain"
          style={{
            display: "none",
            zIndex: 50,
            width: `${OVERLAY_WIDTH_RATIO * 100}%`,
            right: `${(OVERLAY_PADDING_PX / 1080) * 100}%`,
            bottom: `${(OVERLAY_PADDING_PX / 1080) * 100}%`,
          }}
        />
        {frameSize.width > 0 && frameSize.height > 0 && (
          <TextOverlayLayer frameWidthPx={frameSize.width} frameHeightPx={frameSize.height} />
        )}
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
