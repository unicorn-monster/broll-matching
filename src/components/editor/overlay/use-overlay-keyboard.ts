"use client";

import { useEffect } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { splitOverlayAtMs, removeOverlay, compactTracks } from "@/lib/overlay/overlay-store";

function isInTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

export function useOverlayKeyboard() {
  const { overlays, setOverlays, selectedOverlayId, setSelectedOverlayId, playheadMs } =
    useBuildState();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isInTextField(e.target)) return;
      if (!selectedOverlayId) return;

      if (e.code === "KeyC" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOverlays((prev) => compactTracks(splitOverlayAtMs(prev, selectedOverlayId, playheadMs)));
        return;
      }

      if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        setOverlays((prev) => compactTracks(removeOverlay(prev, selectedOverlayId)));
        setSelectedOverlayId(null);
        return;
      }

      if (e.code === "Escape") {
        setSelectedOverlayId(null);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlays, selectedOverlayId, setOverlays, setSelectedOverlayId, playheadMs]);
}
