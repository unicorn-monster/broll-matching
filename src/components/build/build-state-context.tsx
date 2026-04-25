"use client";

import { createContext, useContext, useState } from "react";
import type { ParsedSection } from "@/lib/script-parser";
import type { MatchedSection } from "@/lib/auto-match";

interface BuildState {
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
}

const BuildStateContext = createContext<BuildState | null>(null);

export function BuildStateProvider({ children }: { children: React.ReactNode }) {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [timeline, setTimeline] = useState<MatchedSection[] | null>(null);

  function setAudio(file: File | null, duration: number | null) {
    setAudioFile(file);
    setAudioDuration(duration);
  }

  function onParsed(s: ParsedSection[], t: MatchedSection[]) {
    setSections(s);
    setTimeline(t);
  }

  function clearParsed() {
    setSections(null);
    setTimeline(null);
  }

  return (
    <BuildStateContext.Provider value={{ audioFile, audioDuration, setAudio, scriptText, setScriptText, sections, timeline, setTimeline, onParsed, clearParsed }}>
      {children}
    </BuildStateContext.Provider>
  );
}

export function useBuildState() {
  const ctx = useContext(BuildStateContext);
  if (!ctx) throw new Error("useBuildState must be used within BuildStateProvider");
  return ctx;
}
