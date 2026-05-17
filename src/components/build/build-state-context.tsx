// src/components/build/build-state-context.tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { toast } from "sonner";
import type { MatchedSection } from "@/lib/auto-match";
import { buildClipsByBaseName } from "@/lib/auto-match";
import { preserveLocks } from "@/lib/lock-preserve";
import type { ParsedSection } from "@/lib/script-parser";
import type { OverlayItem } from "@/lib/overlay/overlay-types";
import { shuffleTimeline as shuffleTimelineHelper, type ShuffleResult } from "@/lib/shuffle";
import { useMediaPool } from "@/state/media-pool";
import type { TalkingHeadKind, TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";
import { makeMattedFileId } from "@/lib/talking-head/talking-head-types";
import {
  addOrReplaceLayer,
  removeLayer as removeLayerPure,
  setMattingProgress,
  setMattingStatus,
} from "@/lib/talking-head/talking-head-store";
import { pruneStaleKeys } from "@/lib/matting/section-key";
import {
  extractFramesAndSendToWorker,
  type FrameExtractor,
} from "@/lib/matting/frame-extractor";
import { putMattedFile } from "@/lib/media-storage";

interface BuildState {
  // Project inputs
  audioFile: File | null;
  audioDuration: number | null;
  setAudio: (file: File | null, duration: number | null) => void;
  scriptText: string;
  setScriptText: (t: string) => void;
  sections: ParsedSection[] | null;
  timeline: MatchedSection[] | null;
  setTimeline: (t: MatchedSection[]) => void;
  shuffleTimeline: () => void;
  toggleSectionLock: (index: number) => void;
  onParsed: (s: ParsedSection[], t: MatchedSection[]) => void;
  clearParsed: () => void;

  // Editor UI state
  selectedSectionIndex: number | null;
  setSelectedSectionIndex: (i: number | null) => void;
  playheadMs: number;
  setPlayheadMs: (ms: number) => void;
  audioDialogOpen: boolean;
  setAudioDialogOpen: (open: boolean) => void;
  scriptDialogOpen: boolean;
  setScriptDialogOpen: (open: boolean) => void;
  exportDialogOpen: boolean;
  setExportDialogOpen: (open: boolean) => void;

  // Overlay tracks (free-form clips above main track)
  overlays: OverlayItem[];
  setOverlays: (next: OverlayItem[] | ((prev: OverlayItem[]) => OverlayItem[])) => void;
  selectedOverlayId: string | null;
  setSelectedOverlayId: (id: string | null) => void;
  countOverlaysUsingClips: (clipIds: string[]) => number;
  removeOverlaysReferencingClips: (clipIds: string[]) => number;
  audioSelected: boolean;
  setAudioSelected: (v: boolean) => void;
  textOverlayApplyAll: boolean;
  setTextOverlayApplyAll: (v: boolean) => void;

  // Talking-head layers (2-fixed-layer kind-based model: 'full' + 'overlay').
  // Adding a layer with a kind that already exists REPLACES the existing one.
  talkingHeadLayers: TalkingHeadLayer[];
  talkingHeadFiles: Map<string, File>;
  addTalkingHeadLayer: (args: { kind: TalkingHeadKind; file: File; label?: string }) => { ok: boolean; reason?: string };
  removeTalkingHeadLayer: (id: string) => void;
  /** No-op stub kept for legacy UI callsites; the 2-fixed-layer model has no rename concept.
   *  Task 14 will remove the last caller. */
  renameTalkingHeadLayer: (id: string, newTag: string) => { ok: boolean; reason?: string };
  /** Cancel an in-flight matting job and drop the layer entirely (including original blob). */
  abortMatting: (layerId: string) => void;
  /** Re-run matting for a failed overlay layer using its still-cached original file. */
  retryMatting: (layerId: string) => void;

  // Per-shot disable for overlay (cutout PIP) sections. Keyed by `${startMs}-${endMs}`
  // so the decision survives shuffle / reorder. Pruned automatically when a shot's
  // boundaries change (effectively becoming a different shot) on every reparse.
  disabledOverlayShots: Set<string>;
  disableOverlayShot: (key: string) => void;
  restoreOverlayShot: (key: string) => void;

  // Derived
  inspectorMode: "section" | "overlay" | "audio" | "empty";
  canExport: boolean;

  // Broll click-to-preview state.
  previewClipKey: string | null;
  setPreviewClipKey: (key: string | null) => void;

  // Imperative seek handle — player registers on mount, timeline calls it.
  playerSeekRef: MutableRefObject<((ms: number) => void) | null>;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  playerTogglePlayRef: MutableRefObject<(() => void) | null>;
}

const BuildStateContext = createContext<BuildState | null>(null);

function buildShuffleToast(result: ShuffleResult): string {
  const parts = [`Shuffled ${result.shuffledCount} section${result.shuffledCount === 1 ? "" : "s"}`];
  if (result.lockedKeptCount > 0) parts.push(`${result.lockedKeptCount} locked kept`);
  if (result.talkingHeadCount > 0) parts.push(`${result.talkingHeadCount} talking-head`);
  if (result.placeholderCount > 0) parts.push(`${result.placeholderCount} unmatched`);
  return parts.join(" · ");
}

export function BuildStateProvider({ children }: { children: React.ReactNode }) {
  const { videos: mediaPoolClips } = useMediaPool();

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [timeline, setTimeline] = useState<MatchedSection[] | null>(null);

  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [previewClipKey, setPreviewClipKey] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const playerSeekRef = useRef<((ms: number) => void) | null>(null);
  const playerTogglePlayRef = useRef<(() => void) | null>(null);

  const [talkingHeadLayers, setTalkingHeadLayers] = useState<TalkingHeadLayer[]>([]);
  const [talkingHeadFiles, setTalkingHeadFiles] = useState<Map<string, File>>(new Map());
  const [disabledOverlayShots, setDisabledOverlayShots] = useState<Set<string>>(new Set());

  // Each overlay layer gets one worker, keyed by layer id. We keep these in a ref so
  // a re-render mid-matting doesn't recreate the map and lose the handle we need to
  // terminate the worker on abort/replace. Worker lifetime is tied to its layer:
  // - 'done' or 'failed' → terminate + delete here.
  // - layer replaced / removed / aborted → caller terminates explicitly via abortMatting.
  const mattingWorkers = useRef<Map<string, Worker>>(new Map());
  // Parallel map of frame-extractor handles. We have to abort the extractor
  // alongside terminating the worker, otherwise the extractor's seek loop hangs
  // forever waiting for a `frame-ack` that the terminated worker will never send,
  // leaking the hidden <video> element + object URL.
  const mattingExtractors = useRef<Map<string, FrameExtractor>>(new Map());

  // Spawns the matting worker for an overlay layer and wires it into state. Pure helper —
  // the layer record itself is created by addOrReplaceLayer before this runs.
  const startMatting = useCallback((layer: TalkingHeadLayer, file: File) => {
    // NOTE: the matting worker is pre-bundled by esbuild as IIFE (CLASSIC worker) to
    // /public/matting-worker.bundle.js (see `pnpm build:matting-worker`). Two reasons:
    //   1. Next.js dev bundlers (Turbopack/Webpack) hang chunking the heavy MediaPipe deps.
    //   2. MediaPipe's wasm loader uses `importScripts()` which fails in module workers
    //      ("Module scripts don't support importScripts()"). Classic worker is required.
    const worker = new Worker("/matting-worker.bundle.js");
    mattingWorkers.current.set(layer.id, worker);
    // The matting pipeline is split: HTMLVideoElement decode + frame extraction
    // lives on the main thread (browser native mp4 decoder handles every mp4 it
    // can play — the prior mp4box.js demux stalled on B-frame/missing-DTS layouts
    // from CapCut/QuickTime). The worker is responsible only for MediaPipe
    // segmentation, I420A composition, VP9-alpha encode, and webm muxing.
    // `extractFramesAndSendToWorker` drives the init → frame*N → finish protocol;
    // we still own the worker's `done`, `failed`, and `progress` messages here so
    // they can update talking-head layer state.
    worker.onmessage = async (e: MessageEvent) => {
      const data = e.data as
        | { type: "inited" }
        | { type: "frame-ack"; index: number }
        | { type: "progress"; framesDone: number; totalFrames: number }
        | { type: "done"; mattedBlob: Blob }
        | { type: "failed"; message: string };
      // `inited` and `frame-ack` are consumed by the frame extractor's own
      // listener — we ignore them here to keep the layer-state logic focused
      // on the messages that actually change visible UI.
      if (data.type === "inited" || data.type === "frame-ack") return;
      if (data.type === "progress") {
        setTalkingHeadLayers((prev) =>
          setMattingProgress(prev, layer.id, {
            framesDone: data.framesDone,
            totalFrames: data.totalFrames,
          }),
        );
      } else if (data.type === "done") {
        const mattedFileId = makeMattedFileId(layer.id);
        const filename = `${mattedFileId}.webm`;
        // Persist to IDB first so a reload during this gap still finds the matted webm;
        // only after that do we flip the layer status to 'ready' for downstream consumers.
        await putMattedFile({ id: mattedFileId, blob: data.mattedBlob, filename });
        setTalkingHeadLayers((prev) => setMattingStatus(prev, layer.id, "ready", mattedFileId));
        setTalkingHeadFiles((prev) => {
          const next = new Map(prev);
          next.set(mattedFileId, new File([data.mattedBlob], filename, { type: "video/webm" }));
          return next;
        });
        worker.terminate();
        mattingWorkers.current.delete(layer.id);
        mattingExtractors.current.delete(layer.id);
      } else if (data.type === "failed") {
        setTalkingHeadLayers((prev) => setMattingStatus(prev, layer.id, "failed"));
        worker.terminate();
        mattingWorkers.current.delete(layer.id);
        mattingExtractors.current.get(layer.id)?.abort();
        mattingExtractors.current.delete(layer.id);
      }
    };

    // Kick off main-thread extraction. The extractor sends `init`, streams
    // each frame as a transferable ImageBitmap, then sends `finish`. We hold
    // the returned `abort` handle so abortMatting / removeTalkingHeadLayer can
    // tear down the hidden <video> + object URL (terminating the worker alone
    // would leave the extractor's seek loop blocked on a never-arriving ack).
    const extractor = extractFramesAndSendToWorker(file, worker, {
      onError: (err) => {
        setTalkingHeadLayers((prev) => setMattingStatus(prev, layer.id, "failed"));
        const w = mattingWorkers.current.get(layer.id);
        if (w) {
          w.terminate();
          mattingWorkers.current.delete(layer.id);
        }
        mattingExtractors.current.delete(layer.id);
        console.error("[matting] frame extractor failed:", err);
      },
    });
    mattingExtractors.current.set(layer.id, extractor);
  }, []);

  // Talking-head layers are session-only (in-memory) — no IndexedDB persistence by design.
  // User re-adds via the modal after every reload. The 2-fixed-layer model keys layers by
  // `kind` ('full' | 'overlay') — adding a layer of an existing kind REPLACES it (and drops
  // any matted webm tied to the old layer). For overlay layers we also kick off the matting
  // worker; replacing an overlay implicitly terminates the prior worker via abortMatting on
  // the existing layer's id (the addOrReplaceLayer helper already discards its files).
  const addTalkingHeadLayer = useCallback(
    (args: { kind: TalkingHeadKind; file: File; label?: string }) => {
      // If we're replacing an overlay layer mid-matting, terminate the in-flight worker
      // before we lose the layer id we used to key it.
      if (args.kind === "overlay") {
        const existing = talkingHeadLayers.find((l) => l.kind === "overlay");
        if (existing) {
          const w = mattingWorkers.current.get(existing.id);
          if (w) {
            w.terminate();
            mattingWorkers.current.delete(existing.id);
          }
          mattingExtractors.current.get(existing.id)?.abort();
          mattingExtractors.current.delete(existing.id);
        }
      }
      const result = addOrReplaceLayer(talkingHeadLayers, args, talkingHeadFiles);
      setTalkingHeadLayers(result.layers);
      setTalkingHeadFiles(result.files);
      if (args.kind === "overlay") {
        const newLayer = result.layers.find((l) => l.kind === "overlay");
        if (newLayer) startMatting(newLayer, args.file);
      }
      return { ok: true };
    },
    [talkingHeadLayers, talkingHeadFiles, startMatting],
  );

  const abortMatting = useCallback(
    (layerId: string) => {
      const w = mattingWorkers.current.get(layerId);
      if (w) {
        w.terminate();
        mattingWorkers.current.delete(layerId);
      }
      mattingExtractors.current.get(layerId)?.abort();
      mattingExtractors.current.delete(layerId);
      const layer = talkingHeadLayers.find((l) => l.id === layerId);
      setTalkingHeadLayers((prev) => prev.filter((l) => l.id !== layerId));
      setTalkingHeadFiles((prev) => {
        if (!layer) return prev;
        const next = new Map(prev);
        next.delete(layer.fileId);
        if (layer.mattedFileId) next.delete(layer.mattedFileId);
        return next;
      });
    },
    [talkingHeadLayers],
  );

  const retryMatting = useCallback(
    (layerId: string) => {
      const layer = talkingHeadLayers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== "overlay") return;
      const file = talkingHeadFiles.get(layer.fileId);
      if (!file) return;
      setTalkingHeadLayers((prev) => setMattingStatus(prev, layerId, "processing"));
      startMatting(layer, file);
    },
    [talkingHeadLayers, talkingHeadFiles, startMatting],
  );

  const removeTalkingHeadLayer = useCallback(
    (id: string) => {
      // Terminate the matting worker first so it can't deliver a 'done' message that
      // resurrects a layer we just removed (the postMessage would race the setState).
      const w = mattingWorkers.current.get(id);
      if (w) {
        w.terminate();
        mattingWorkers.current.delete(id);
      }
      mattingExtractors.current.get(id)?.abort();
      mattingExtractors.current.delete(id);
      // removeLayer purges the layer's original + matted file blobs in one call.
      const result = removeLayerPure(talkingHeadLayers, id, talkingHeadFiles);
      setTalkingHeadLayers(result.layers);
      setTalkingHeadFiles(result.files);
    },
    [talkingHeadLayers, talkingHeadFiles],
  );

  // No-op stub. The 2-fixed-layer model derives tags from `kind`, so renaming is
  // meaningless. Kept only so legacy inspector callsites typecheck until Task 14
  // strips the rename UI.
  const renameTalkingHeadLayer = useCallback(
    (_id: string, _newTag: string) => ({ ok: false, reason: "no-op-in-fixed-layer-model" }),
    [],
  );

  const disableOverlayShot = useCallback((key: string) => {
    setDisabledOverlayShots((prev) => new Set(prev).add(key));
  }, []);

  const restoreOverlayShot = useCallback((key: string) => {
    setDisabledOverlayShots((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const [overlays, setOverlaysState] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [audioSelected, setAudioSelected] = useState(false);
  const [textOverlayApplyAll, setTextOverlayApplyAllState] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("text-overlay-apply-all");
    if (stored === "false") setTextOverlayApplyAllState(false);
  }, []);

  const setTextOverlayApplyAll = useCallback((v: boolean) => {
    setTextOverlayApplyAllState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("text-overlay-apply-all", v ? "true" : "false");
    }
  }, []);

  const setOverlays = useCallback(
    (next: OverlayItem[] | ((prev: OverlayItem[]) => OverlayItem[])) => {
      setOverlaysState((prev) =>
        typeof next === "function" ? (next as (p: OverlayItem[]) => OverlayItem[])(prev) : next,
      );
    },
    [],
  );

  const countOverlaysUsingClips = useCallback(
    (clipIds: string[]) => {
      const set = new Set(clipIds);
      return overlays.filter((o) => o.kind === "broll-video" && set.has(o.clipId)).length;
    },
    [overlays],
  );

  const removeOverlaysReferencingClips = useCallback(
    (clipIds: string[]) => {
      const set = new Set(clipIds);
      let removed = 0;
      setOverlaysState((prev) => {
        const next = prev.filter((o) => {
          if (o.kind === "broll-video" && set.has(o.clipId)) { removed++; return false; }
          return true;
        });
        return next;
      });
      return removed;
    },
    [],
  );

  // Re-match deterministically when talking-head layers change. Uses preserveLocks so
  // any user-locked B-roll sections survive. Talking-head sections themselves never carry
  // locks because re-roll/swap controls are hidden for them.
  useEffect(() => {
    if (!sections || !timeline) return;
    const clipsByBaseName = buildClipsByBaseName(mediaPoolClips);
    const result = preserveLocks(
      timeline,
      sections,
      clipsByBaseName,
      talkingHeadLayers,
      disabledOverlayShots,
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeline(result.newTimeline);
    if (result.droppedCount > 0) {
      console.warn(`[talking-head re-match] ${result.droppedCount} locks dropped`);
    }
    // sections, timeline, mediaPoolClips deliberately excluded from deps:
    // - sections/timeline: always current at effect-run time because they update via onParsed
    //   before any TH config edit; including them would cause infinite re-fire loops.
    // - mediaPoolClips: B-roll changes are handled by onParsed, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talkingHeadLayers]);

  function setAudio(file: File | null, duration: number | null) {
    setAudioFile(file);
    setAudioDuration(duration);
  }

  const shuffleTimeline = useCallback(() => {
    if (!timeline) return;
    const clipsByBaseName = buildClipsByBaseName(mediaPoolClips);
    const result = shuffleTimelineHelper(timeline, clipsByBaseName, talkingHeadLayers);
    setIsPlaying(false);
    setTimeline(result.newTimeline);
    setPreviewClipKey(null);
    toast.success(buildShuffleToast(result));
  }, [timeline, mediaPoolClips, talkingHeadLayers]);

  const toggleSectionLock = useCallback((index: number) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      const target = prev[index];
      if (!target) return prev;
      const next = [...prev];
      next[index] = { ...target, userLocked: !target.userLocked };
      return next;
    });
  }, []);

  function onParsed(s: ParsedSection[], t: MatchedSection[]) {
    setSections(s);
    setTimeline(t);
    setSelectedSectionIndex(null);
    // Drop disable-shot keys whose section boundaries changed (or vanished). ParsedSection
    // tracks times in seconds — convert to ms (×1000) to match the section-key format.
    const ranges = s.map((p) => ({ startMs: p.startTime * 1000, endMs: p.endTime * 1000 }));
    setDisabledOverlayShots((prev) => pruneStaleKeys(prev, ranges));
  }

  function clearParsed() {
    setSections(null);
    setTimeline(null);
    setSelectedSectionIndex(null);
    // Script was cleared — no live shots remain, so all disable keys are stale.
    setDisabledOverlayShots(new Set());
  }

  const value = useMemo<BuildState>(() => {
    const inspectorMode: "section" | "overlay" | "audio" | "empty" =
      selectedOverlayId !== null
        ? "overlay"
        : audioSelected
          ? "audio"
          : selectedSectionIndex !== null && timeline
            ? "section"
            : "empty";
    const canExport =
      !!audioFile &&
      !!timeline &&
      timeline.length > 0 &&
      timeline.every((s) => s.clips.length > 0);
    return {
      audioFile,
      audioDuration,
      setAudio,
      talkingHeadLayers,
      talkingHeadFiles,
      addTalkingHeadLayer,
      removeTalkingHeadLayer,
      renameTalkingHeadLayer,
      abortMatting,
      retryMatting,
      disabledOverlayShots,
      disableOverlayShot,
      restoreOverlayShot,
      scriptText,
      setScriptText,
      sections,
      timeline,
      setTimeline,
      shuffleTimeline,
      toggleSectionLock,
      onParsed,
      clearParsed,
      selectedSectionIndex,
      setSelectedSectionIndex,
      playheadMs,
      setPlayheadMs,
      audioDialogOpen,
      setAudioDialogOpen,
      scriptDialogOpen,
      setScriptDialogOpen,
      exportDialogOpen,
      setExportDialogOpen,
      previewClipKey,
      setPreviewClipKey,
      overlays,
      setOverlays,
      selectedOverlayId,
      setSelectedOverlayId,
      countOverlaysUsingClips,
      removeOverlaysReferencingClips,
      audioSelected,
      setAudioSelected,
      textOverlayApplyAll,
      setTextOverlayApplyAll,
      inspectorMode,
      canExport,
      playerSeekRef,
      isPlaying,
      setIsPlaying,
      playerTogglePlayRef,
    };
  }, [
    audioFile,
    audioDuration,
    talkingHeadLayers,
    talkingHeadFiles,
    addTalkingHeadLayer,
    removeTalkingHeadLayer,
    renameTalkingHeadLayer,
    abortMatting,
    retryMatting,
    disabledOverlayShots,
    disableOverlayShot,
    restoreOverlayShot,
    scriptText,
    sections,
    timeline,
    shuffleTimeline,
    toggleSectionLock,
    selectedSectionIndex,
    playheadMs,
    audioDialogOpen,
    scriptDialogOpen,
    exportDialogOpen,
    previewClipKey,
    isPlaying,
    overlays,
    setOverlays,
    selectedOverlayId,
    audioSelected,
    textOverlayApplyAll,
    setTextOverlayApplyAll,
    countOverlaysUsingClips,
    removeOverlaysReferencingClips,
  ]);

  return <BuildStateContext.Provider value={value}>{children}</BuildStateContext.Provider>;
}

export function useBuildState() {
  const ctx = useContext(BuildStateContext);
  if (!ctx) throw new Error("useBuildState must be used within BuildStateProvider");
  return ctx;
}
