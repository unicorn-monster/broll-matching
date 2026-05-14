"use client";

import { useState } from "react";
import { Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { DEFAULT_TEXT_STYLE } from "@/lib/text-overlay/text-style-defaults";
import { generateFromSections, mergeCaptions } from "@/lib/text-overlay/text-overlay-store";
import { GenerateCaptionsDialog } from "../dialogs/generate-captions-dialog";

export function GenerateCaptionsButton() {
  const { sections, overlays, setOverlays } = useBuildState();
  const [open, setOpen] = useState(false);
  const hasExistingText = overlays.some((o) => o.kind === "text");

  function onClick() {
    if (!sections || sections.length === 0) return;
    if (!hasExistingText) {
      const fresh = generateFromSections(sections, DEFAULT_TEXT_STYLE);
      setOverlays((prev) => [...prev, ...fresh]);
      return;
    }
    setOpen(true);
  }

  function doReplace() {
    if (!sections) return;
    setOverlays((prev) => mergeCaptions(prev, sections, DEFAULT_TEXT_STYLE, "replace"));
    setOpen(false);
  }
  function doMerge() {
    if (!sections) return;
    setOverlays((prev) => mergeCaptions(prev, sections, DEFAULT_TEXT_STYLE, "merge"));
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
