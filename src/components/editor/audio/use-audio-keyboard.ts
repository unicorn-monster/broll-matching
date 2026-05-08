"use client";

import { useEffect } from "react";
import { useBuildState } from "@/components/build/build-state-context";

function isInTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

export function useAudioKeyboard() {
  const { audioSelected, setAudio, setAudioSelected, setIsPlaying } = useBuildState();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isInTextField(e.target)) return;
      if (!audioSelected) return;

      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        setIsPlaying(false);
        setAudio(null, null);
        setAudioSelected(false);
        return;
      }

      if (e.code === "Escape") {
        setAudioSelected(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [audioSelected, setAudio, setAudioSelected, setIsPlaying]);
}
