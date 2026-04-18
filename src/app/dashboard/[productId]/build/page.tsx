"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { StepWrapper } from "@/components/build/step-wrapper";
import { AudioUpload } from "@/components/build/audio-upload";
import { ScriptPaste } from "@/components/build/script-paste";
import { TimelinePreview } from "@/components/build/timeline-preview";
import { RenderTrigger } from "@/components/build/render-trigger";
import { deriveBaseName } from "@/lib/broll";
import type { ParsedSection } from "@/lib/script-parser";
import type { MatchedSection } from "@/lib/auto-match";

export default function BuildVideoPage() {
  const { productId } = useParams<{ productId: string }>();
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [timeline, setTimeline] = useState<MatchedSection[] | null>(null);
  const [availableBaseNames, setAvailableBaseNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/products/${productId}/clips`)
      .then((r) => r.json())
      .then((clips) => {
        const names = new Set<string>(clips.map((c: { brollName: string }) => deriveBaseName(c.brollName)));
        setAvailableBaseNames(names);
      });
  }, [productId]);

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <h1 className="text-2xl font-bold">Build Video</h1>

      <StepWrapper step={1} title="Upload Audio" active>
        <AudioUpload onAudioReady={setAudioFile} />
      </StepWrapper>

      <StepWrapper step={2} title="Paste Script" active>
        <ScriptPaste
          availableBaseNames={availableBaseNames}
          productId={productId}
          onParsed={(s: ParsedSection[], t: MatchedSection[]) => { setSections(s); setTimeline(t); }}
        />
      </StepWrapper>

      <StepWrapper step={3} title="Review Timeline" active={!!sections} waitingFor="Script">
        {timeline && (
          <TimelinePreview
            timeline={timeline}
            productId={productId}
            onTimelineChange={setTimeline}
          />
        )}
      </StepWrapper>

      <StepWrapper step={4} title="Render Video" active={!!audioFile && !!timeline} waitingFor="Audio + Timeline">
        {audioFile && timeline && (
          <RenderTrigger audioFile={audioFile} timeline={timeline} />
        )}
      </StepWrapper>
    </div>
  );
}
