// src/components/build/build-state-context.tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { MatchedSection } from "@/lib/auto-match";
import { buildClipsByBaseName, TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
import { preserveLocks } from "@/lib/lock-preserve";
import type { ParsedSection } from "@/lib/script-parser";
import type { OverlayItem } from "@/lib/overlay/overlay-types";
import { useMediaPool } from "@/state/media-pool";

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

  talkingHeadFile: File | null;
  talkingHeadTag: string;
  setTalkingHead: (file: File | null) => void;
  setTalkingHeadTag: (tag: string) => void;

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

  const [talkingHeadFile, setTalkingHeadFileState] = useState<File | null>(null);
  const [talkingHeadTag, setTalkingHeadTagState] = useState<string>("ugc-head");

  const setTalkingHead = useCallback((file: File | null) => {
    setTalkingHeadFileState(file);
  }, []);
  const setTalkingHeadTag = useCallback((tag: string) => {
    // Always store lowercase — match logic compares `section.tag.toLowerCase()` to this value.
    setTalkingHeadTagState(tag.trim().toLowerCase());
  }, []);

  const [overlays, setOverlaysState] = useState<OverlayItem[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [audioSelected, setAudioSelected] = useState(false);
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
      return overlays.filter((o) => set.has(o.clipId)).length;
    },
    [overlays],
  );

  const removeOverlaysReferencingClips = useCallback(
    (clipIds: string[]) => {
      const set = new Set(clipIds);
      let removed = 0;
      setOverlaysState((prev) => {
        const next = prev.filter((o) => {
          if (set.has(o.clipId)) { removed++; return false; }
          return true;
        });
        return next;
      });
      return removed;
    },
    [],
  );

  // Re-match deterministically when talking-head config changes. Uses preserveLocks so
  // any user-locked B-roll sections survive. Talking-head sections themselves never carry
  // locks because re-roll/swap controls are hidden for them.
  useEffect(() => {
    if (!sections || !timeline) return;
    const clipsByBaseName = buildClipsByBaseName(mediaPoolClips);
    const thConfig = talkingHeadFile && talkingHeadTag.length > 0
      ? { fileId: TALKING_HEAD_FILE_ID, tag: talkingHeadTag }
      : null;
    const result = preserveLocks(timeline, sections, clipsByBaseName, thConfig);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeline(result.newTimeline);
    if (result.droppedCount > 0) {
      console.warn(`[talking-head re-match] ${result.droppedCount} locks dropped`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talkingHeadFile, talkingHeadTag]);

  function setAudio(file: File | null, duration: number | null) {
    setAudioFile(file);
    setAudioDuration(duration);
  }

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
      talkingHeadFile,
      talkingHeadTag,
      setTalkingHead,
      setTalkingHeadTag,
      scriptText,
      setScriptText,
      sections,
      timeline,
      setTimeline,
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
    talkingHeadFile,
    talkingHeadTag,
    scriptText,
    sections,
    timeline,
    selectedSectionIndex,
    playheadMs,
    audioDialogOpen,
    scriptDialogOpen,
    exportDialogOpen,
    previewClipKey,
    isPlaying,
    overlays,
    selectedOverlayId,
    audioSelected,
  ]);

  return <BuildStateContext.Provider value={value}>{children}</BuildStateContext.Provider>;
}

export function useBuildState() {
  const ctx = useContext(BuildStateContext);
  if (!ctx) throw new Error("useBuildState must be used within BuildStateProvider");
  return ctx;
}
