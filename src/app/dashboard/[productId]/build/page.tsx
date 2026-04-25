"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { StepWrapper } from "@/components/build/step-wrapper";
import { AudioUpload } from "@/components/build/audio-upload";
import { ScriptPaste } from "@/components/build/script-paste";
import { TimelinePreview } from "@/components/build/timeline-preview";
import { RenderTrigger } from "@/components/build/render-trigger";
import { useBuildState } from "@/components/build/build-state-context";
import { deriveBaseName } from "@/lib/broll";
import { useState } from "react";

export default function BuildVideoPage() {
  const { productId } = useParams<{ productId: string }>();
  const { audioFile, audioDuration, setAudio, scriptText, setScriptText, sections, timeline, onParsed, setTimeline } = useBuildState();
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
        <AudioUpload file={audioFile} duration={audioDuration} onFile={setAudio} />
      </StepWrapper>

      <StepWrapper step={2} title="Paste Script" active>
        <ScriptPaste
          text={scriptText}
          onTextChange={setScriptText}
          availableBaseNames={availableBaseNames}
          productId={productId}
          onParsed={onParsed}
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
