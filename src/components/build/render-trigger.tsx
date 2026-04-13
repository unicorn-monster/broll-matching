"use client";

import { Clapperboard, Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RenderPhase } from "@/workers/render-worker";

export type RenderStatus =
  | "idle"
  | RenderPhase    // "loading" | "rendering" | "muxing"
  | "complete"
  | "error";

interface RenderTriggerProps {
  onRender: () => void;
  disabled: boolean;
  renderStatus: RenderStatus;
  currentSegment: number;
  totalSegments: number;
  downloadUrl: string | null;
  errorMessage: string | null;
}

const PHASE_LABELS: Record<RenderPhase, string> = {
  loading: "Loading FFmpeg…",
  muxing: "Mixing audio…",
  rendering: "",
};

export function RenderTrigger({
  onRender,
  disabled,
  renderStatus,
  currentSegment,
  totalSegments,
  downloadUrl,
  errorMessage,
}: RenderTriggerProps) {
  const isRunning =
    renderStatus === "loading" ||
    renderStatus === "rendering" ||
    renderStatus === "muxing";

  // ---- Active render: progress bar ----------------------------------------
  if (isRunning) {
    const phaseLit = renderStatus as RenderPhase;
    const label =
      renderStatus === "rendering"
        ? `Segment ${currentSegment} of ${totalSegments}`
        : PHASE_LABELS[phaseLit];

    const progressPct =
      renderStatus === "loading"
        ? 3
        : renderStatus === "muxing"
        ? 97
        : totalSegments > 0
        ? Math.round((currentSegment / totalSegments) * 94) + 3
        : 3;

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    );
  }

  // ---- Complete: download + re-render -------------------------------------
  if (renderStatus === "complete" && downloadUrl) {
    return (
      <div className="flex flex-col gap-2">
        <a href={downloadUrl} download="output.mp4" className="block">
          <Button size="lg" className="w-full gap-2">
            <Download className="w-4 h-4" />
            Download Video
          </Button>
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="w-full gap-2 text-muted-foreground"
          onClick={onRender}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Render again
        </Button>
      </div>
    );
  }

  // ---- Error ---------------------------------------------------------------
  if (renderStatus === "error") {
    return (
      <div className="flex flex-col gap-3">
        {errorMessage && (
          <p className="text-xs text-destructive rounded-md bg-destructive/10 px-3 py-2">
            {errorMessage}
          </p>
        )}
        <Button size="lg" className="w-full gap-2" onClick={onRender} disabled={disabled}>
          <RotateCcw className="w-4 h-4" />
          Try Again
        </Button>
      </div>
    );
  }

  // ---- Idle ----------------------------------------------------------------
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={onRender}
        disabled={disabled}
      >
        <Clapperboard className="w-4 h-4" />
        Render Video
      </Button>
      {disabled && (
        <p className="text-xs text-muted-foreground text-center">
          Complete Steps 1–3 to enable rendering
        </p>
      )}
    </div>
  );
}
