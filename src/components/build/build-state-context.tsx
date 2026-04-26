// src/components/build/build-state-context.tsx
"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ParsedSection } from "@/lib/script-parser";
import type { MatchedSection } from "@/lib/auto-match";

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

  // Derived
  inspectorMode: "section" | "empty";
  canExport: boolean;
}

const BuildStateContext = createContext<BuildState | null>(null);

export function BuildStateProvider({ children }: { children: React.ReactNode }) {
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
    const inspectorMode: "section" | "empty" =
      selectedSectionIndex !== null && timeline ? "section" : "empty";
    const canExport =
      !!audioFile &&
      !!timeline &&
      timeline.length > 0 &&
      timeline.every((s) => s.clips.length > 0);
    return {
      audioFile,
      audioDuration,
      setAudio,
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
      inspectorMode,
      canExport,
    };
  }, [
    audioFile,
    audioDuration,
    scriptText,
    sections,
    timeline,
    selectedSectionIndex,
    playheadMs,
    audioDialogOpen,
    scriptDialogOpen,
    exportDialogOpen,
  ]);

  return <BuildStateContext.Provider value={value}>{children}</BuildStateContext.Provider>;
}

export function useBuildState() {
  const ctx = useContext(BuildStateContext);
  if (!ctx) throw new Error("useBuildState must be used within BuildStateProvider");
  return ctx;
}
