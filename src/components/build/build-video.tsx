"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { StepWrapper } from "@/components/build/step-wrapper";
import { AudioUpload } from "@/components/build/audio-upload";
import { ScriptPaste } from "@/components/build/script-paste";
import { TimelinePreview } from "@/components/build/timeline-preview";
import { RenderTrigger } from "@/components/build/render-trigger";
import {
  matchSections,
  rerollSection,
  swapClip,
  type ClipMetadata,
  type MatchedSection,
} from "@/lib/auto-match";
import { parseScript, type ParseResult } from "@/lib/script-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiTag {
  id: string;
  name: string;
  sortOrder: number;
  clipCount: number;
}

interface ApiClip {
  id: string;
  tagId: string;
  filename: string;
  durationMs: number;
  width: number;
  height: number;
  indexeddbKey: string;
  fileSizeBytes: number;
}

interface BuildVideoProps {
  productId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuildVideo({ productId }: BuildVideoProps) {
  // Library data
  const [tags, setTags] = useState<ApiTag[]>([]);
  const [clipsByTag, setClipsByTag] = useState<Map<string, ClipMetadata[]>>(new Map());
  const [libraryLoading, setLibraryLoading] = useState(true);

  // Step 1 — audio
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState<number | null>(null);

  // Step 2 — script
  const [parsedSections, setParsedSections] = useState<ParseResult["sections"] | null>(null);

  // Step 3 — matched timeline
  const [matchedSections, setMatchedSections] = useState<MatchedSection[] | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch all clips on mount to build the match-engine data structures
  // ---------------------------------------------------------------------------

  const fetchLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const tagsRes = await fetch(`/api/products/${productId}/tags`);
      if (!tagsRes.ok) return;
      const tagList: ApiTag[] = await tagsRes.json();
      setTags(tagList);

      // Fetch clips for all tags in parallel
      const clipsEntries = await Promise.all(
        tagList.map(async (tag) => {
          const res = await fetch(
            `/api/products/${productId}/tags/${tag.id}/clips`
          );
          if (!res.ok) return [tag.name, []] as [string, ClipMetadata[]];
          const clips: ApiClip[] = await res.json();
          const meta: ClipMetadata[] = clips.map((c) => ({
            id: c.id,
            durationMs: c.durationMs,
          }));
          return [tag.name, meta] as [string, ClipMetadata[]];
        })
      );

      setClipsByTag(new Map(clipsEntries));
    } finally {
      setLibraryLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // ---------------------------------------------------------------------------
  // Step handlers
  // ---------------------------------------------------------------------------

  function handleAudioSelected(file: File, durationMs: number) {
    setAudioFile(file);
    setAudioDurationMs(durationMs);
  }

  function handleAudioCleared() {
    setAudioFile(null);
    setAudioDurationMs(null);
  }

  function handleParsed(result: ReturnType<typeof parseScript>) {
    setParsedSections(result.sections);
    // Auto-match immediately
    const matched = matchSections({ sections: result.sections, clipsByTag });
    setMatchedSections(matched);
  }

  function handleReroll(sectionIndex: number) {
    if (!parsedSections || !matchedSections) return;
    const section = parsedSections[sectionIndex];
    if (!section) return;
    const currentClipIds = matchedSections[sectionIndex]?.clips.map((c) => c.clipId) ?? [];
    const updated = rerollSection(section, sectionIndex, clipsByTag, currentClipIds);
    setMatchedSections((prev) => {
      if (!prev) return prev;
      return prev.map((m) => (m.sectionIndex === sectionIndex ? updated : m));
    });
  }

  function handleSwap(sectionIndex: number, clip: ClipMetadata) {
    if (!parsedSections) return;
    const section = parsedSections[sectionIndex];
    if (!section) return;
    const updated = swapClip(section, sectionIndex, clip);
    setMatchedSections((prev) => {
      if (!prev) return prev;
      return prev.map((m) => (m.sectionIndex === sectionIndex ? updated : m));
    });
  }

  function handleRender() {
    toast.info("Video rendering will be available in Phase 7.");
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const tagNames = tags.map((t) => t.name);
  const renderReady = audioFile !== null && matchedSections !== null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-4">
      {libraryLoading && (
        <p className="text-xs text-muted-foreground text-center">Loading library…</p>
      )}

      {/* Step 1: Audio */}
      <StepWrapper stepNumber={1} title="Upload Audio Track" isActive>
        <AudioUpload
          onAudioSelected={handleAudioSelected}
          onAudioCleared={handleAudioCleared}
          selectedFile={audioFile}
          durationMs={audioDurationMs}
        />
      </StepWrapper>

      {/* Step 2: Script */}
      <StepWrapper
        stepNumber={2}
        title="Paste Script"
        isActive={audioFile !== null}
      >
        <ScriptPaste knownTags={tagNames} onParsed={handleParsed} />
      </StepWrapper>

      {/* Step 3: Timeline */}
      <StepWrapper
        stepNumber={3}
        title="Review Timeline"
        isActive={matchedSections !== null}
      >
        {parsedSections && matchedSections ? (
          <TimelinePreview
            sections={parsedSections}
            matchedSections={matchedSections}
            clipsByTag={clipsByTag}
            onReroll={handleReroll}
            onSwap={handleSwap}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Parse a script in Step 2 to generate the timeline.
          </p>
        )}
      </StepWrapper>

      {/* Step 4: Render */}
      <StepWrapper
        stepNumber={4}
        title="Render Video"
        isActive={renderReady}
      >
        <RenderTrigger onRender={handleRender} disabled={!renderReady} />
      </StepWrapper>
    </div>
  );
}
