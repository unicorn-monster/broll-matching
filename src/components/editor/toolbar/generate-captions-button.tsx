"use client";

import { useState } from "react";
import { Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { DEFAULT_TEXT_STYLE } from "@/lib/text-overlay/text-style-defaults";
import {
  generateFromSections,
  mergeCaptions,
  splitIntoMaxLines,
  type GenerateOptions,
} from "@/lib/text-overlay/text-overlay-store";
import type { MatchedSection } from "@/lib/auto-match";
import type { OverlayItem } from "@/lib/overlay/overlay-types";
import type { ParsedSection } from "@/lib/script-parser";
import { GenerateCaptionsDialog } from "../dialogs/generate-captions-dialog";

// Reference output dimensions used at generate time for line-count splitting decisions.
// Most VSLs ship at 9:16; line-count at 1080×1920 is a stable proxy for the final render.
const REF_OUTPUT_WIDTH = 1080;
const REF_OUTPUT_HEIGHT = 1920;

// Sections and timeline are kept in lockstep order — index i in `sections` corresponds to
// index i in `timeline`. We map by index, then read `lineNumber` from the ParsedSection.
function buildSkipLineNumbers(
  sections: ParsedSection[] | null,
  timeline: MatchedSection[] | null,
): Set<number> {
  const skip = new Set<number>();
  if (!sections || !timeline) return skip;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const m = timeline[i];
    if (!s || !m) continue;
    if (m.clips.length > 0 && m.clips.every((c) => c.isPlaceholder)) {
      skip.add(s.lineNumber);
    }
  }
  return skip;
}

function applySplits(overlays: OverlayItem[]): OverlayItem[] {
  if (typeof document === "undefined") return overlays;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return overlays;
  return splitIntoMaxLines(overlays, ctx, REF_OUTPUT_WIDTH, REF_OUTPUT_HEIGHT);
}

export function GenerateCaptionsButton() {
  const { sections, timeline, overlays, setOverlays } = useBuildState();
  const [open, setOpen] = useState(false);
  const hasExistingText = overlays.some((o) => o.kind === "text");

  function genOptions(): GenerateOptions {
    return { skipLineNumbers: buildSkipLineNumbers(sections, timeline) };
  }

  function onClick() {
    if (!sections || sections.length === 0) return;
    if (!hasExistingText) {
      const fresh = generateFromSections(sections, DEFAULT_TEXT_STYLE, genOptions());
      const split = applySplits(fresh);
      setOverlays((prev) => [...prev, ...split]);
      return;
    }
    setOpen(true);
  }

  function doReplace() {
    if (!sections) return;
    setOverlays((prev) => {
      const merged = mergeCaptions(prev, sections, DEFAULT_TEXT_STYLE, "replace", genOptions());
      return applySplits(merged);
    });
    setOpen(false);
  }
  function doMerge() {
    if (!sections) return;
    setOverlays((prev) => {
      const merged = mergeCaptions(prev, sections, DEFAULT_TEXT_STYLE, "merge", genOptions());
      return applySplits(merged);
    });
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!sections || sections.length === 0}
        onClick={onClick}
        title="Generate captions from parsed script sections"
      >
        <Captions className="w-3.5 h-3.5 mr-1" />
        Generate captions
      </Button>
      <GenerateCaptionsDialog open={open} onOpenChange={setOpen} onReplace={doReplace} onMerge={doMerge} />
    </>
  );
}
