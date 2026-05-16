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
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";
import {
  addLayer as addLayerPure,
  removeLayer as removeLayerPure,
  renameLayer as renameLayerPure,
} from "@/lib/talking-head/talking-head-store";

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

  // Talking-head layers (multi-layer model)
  talkingHeadLayers: TalkingHeadLayer[];
  talkingHeadFiles: Map<string, File>;
  addTalkingHeadLayer: (args: { tag: string; file: File; label?: string }) => { ok: boolean; reason?: string };
  removeTalkingHeadLayer: (id: string) => void;
  renameTalkingHeadLayer: (id: string, newTag: string) => { ok: boolean; reason?: string };

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

  // Talking-head layers are session-only (in-memory) — no IndexedDB persistence by design.
  // User re-adds via the modal after every reload.
  const addTalkingHeadLayer = useCallback(
    (args: { tag: string; file: File; label?: string }) => {
      const result = addLayerPure(talkingHeadLayers, args, talkingHeadFiles);
      if (!result.ok) return { ok: false, reason: result.reason };
      setTalkingHeadLayers(result.layers);
      setTalkingHeadFiles(result.files);
      return { ok: true };
    },
    [talkingHeadLayers, talkingHeadFiles],
  );

  const removeTalkingHeadLayer = useCallback(
    (id: string) => {
      const layer = talkingHeadLayers.find((l) => l.id === id);
      if (!layer) return;
      setTalkingHeadLayers((prev) => removeLayerPure(prev, id));
      setTalkingHeadFiles((prev) => {
        const next = new Map(prev);
        next.delete(layer.fileId);
        return next;
      });
    },
    [talkingHeadLayers],
  );

  const renameTalkingHeadLayer = useCallback(
    (id: string, newTag: string) => {
      const result = renameLayerPure(talkingHeadLayers, id, newTag);
      if (!result.ok) return { ok: false, reason: result.reason };
      setTalkingHeadLayers(result.layers);
      return { ok: true };
    },
    [talkingHeadLayers],
  );

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
    const result = preserveLocks(timeline, sections, clipsByBaseName, talkingHeadLayers);
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
  }

  function clearParsed() {
    setSections(null);
    setTimeline(null);
    setSelectedSectionIndex(null);
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
