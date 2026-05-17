"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { getLayerByKind } from "@/lib/talking-head/talking-head-store";
import { detectMattingSupport, type SupportResult } from "@/lib/matting/browser-support";
import { AddTalkingHeadDialog } from "@/components/editor/dialogs/add-talking-head-dialog";
import { MattingProgressModal } from "@/components/editor/dialogs/matting-progress-modal";
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";
import { cn } from "@/lib/utils";

type OpenModal = null | "add-full" | "add-overlay" | "matting-progress";

/** Two fixed pills (full + overlay) that mirror the AudioPill / ScriptPill
 *  chip style. Replaces the legacy N-layer "Add talking-head" button. */
export function TalkingHeadPills() {
  const { talkingHeadLayers } = useBuildState();
  const full = getLayerByKind(talkingHeadLayers, "full");
  const overlay = getLayerByKind(talkingHeadLayers, "overlay");
  const [open, setOpen] = useState<OpenModal>(null);
  // Defer feature detection to after mount: detectMattingSupport reads `window` and
  // `navigator`, which differ between SSR and client. Rendering the unsupported state
  // initially and swapping after mount avoids a hydration mismatch.
  const [support, setSupport] = useState<SupportResult>({ ok: false, reason: "no-webcodecs" });
  useEffect(() => { setSupport(detectMattingSupport()); }, []);

  const overlayProcessing = overlay?.mattingStatus === "processing";
  const overlayReady = !!overlay && overlay.mattingStatus === "ready";
  const overlayFailed = overlay?.mattingStatus === "failed";

  // Overlay-pill routing: clicking a processing layer opens the live progress modal
  // (with abort), while any other state (empty / ready / failed) opens the add/replace
  // dialog. This avoids the user accidentally launching a re-upload UI mid-job.
  const handleOverlayClick = () => {
    setOpen(overlayProcessing ? "matting-progress" : "add-overlay");
  };

  return (
    <>
      <Pill
        label={full ? "talking-head-full" : "+ talking-head-full"}
        state={full ? "ready" : "empty"}
        onClick={() => setOpen("add-full")}
      />
      <Pill
        label={
          overlay
            ? overlayProcessing
              ? `talking-head-overlay (${overlayProgressPct(overlay)}%)`
              : overlayFailed
                ? "talking-head-overlay (failed)"
                : "talking-head-overlay"
            : "+ talking-head-overlay"
        }
        state={
          overlayProcessing
            ? "processing"
            : overlayReady
              ? "ready"
              : overlayFailed
                ? "failed"
                : "empty"
        }
        disabled={!support.ok}
        {...(!support.ok ? { tooltip: "Yêu cầu Chrome/Edge desktop" } : {})}
        onClick={handleOverlayClick}
      />
      {(open === "add-full" || open === "add-overlay") && (
        <AddTalkingHeadDialog
          kind={open === "add-full" ? "full" : "overlay"}
          existing={open === "add-full" ? full : overlay}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "matting-progress" && (
        <MattingProgressModal onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function overlayProgressPct(layer: TalkingHeadLayer): number {
  const p = layer.mattingProgress;
  if (!p || p.totalFrames === 0) return 0;
  return Math.round((p.framesDone / p.totalFrames) * 100);
}

type PillState = "empty" | "processing" | "ready" | "failed";

interface PillProps {
  label: string;
  state: PillState;
  disabled?: boolean;
  tooltip?: string;
  onClick: () => void;
}

function Pill({ label, state, disabled, tooltip, onClick }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition disabled:opacity-50 disabled:cursor-not-allowed",
        state === "ready" &&
          "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20",
        state === "processing" &&
          "bg-yellow-500/10 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/20",
        state === "failed" &&
          "bg-red-500/10 border-red-500/40 text-red-300 hover:bg-red-500/20",
        state === "empty" &&
          "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <Video className="w-3 h-3" />
      {label}
    </button>
  );
}
