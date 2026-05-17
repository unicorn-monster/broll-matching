"use client";

import { useState } from "react";
import { Video } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { getLayerByKind } from "@/lib/talking-head/talking-head-store";
import { AddTalkingHeadDialog } from "@/components/editor/dialogs/add-talking-head-dialog";
import { cn } from "@/lib/utils";

type OpenModal = null | "add-full" | "add-overlay";

/** Two fixed pills (full + overlay) that mirror the AudioPill / ScriptPill
 *  chip style. Overlay uploads are expected to already carry alpha (matted
 *  externally in CapCut etc.) — the app does no in-browser matting, so the
 *  overlay pill has no "processing" / "failed" state. */
export function TalkingHeadPills() {
  const { talkingHeadLayers } = useBuildState();
  const full = getLayerByKind(talkingHeadLayers, "full");
  const overlay = getLayerByKind(talkingHeadLayers, "overlay");
  const [open, setOpen] = useState<OpenModal>(null);

  return (
    <>
      <Pill
        label={full ? "talking-head-full" : "+ talking-head-full"}
        state={full ? "ready" : "empty"}
        onClick={() => setOpen("add-full")}
      />
      <Pill
        label={overlay ? "talking-head-overlay" : "+ talking-head-overlay"}
        state={overlay ? "ready" : "empty"}
        onClick={() => setOpen("add-overlay")}
      />
      {(open === "add-full" || open === "add-overlay") && (
        <AddTalkingHeadDialog
          kind={open === "add-full" ? "full" : "overlay"}
          existing={open === "add-full" ? full : overlay}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

type PillState = "empty" | "ready";

interface PillProps {
  label: string;
  state: PillState;
  onClick: () => void;
}

function Pill({ label, state, onClick }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition",
        state === "ready" &&
          "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20",
        state === "empty" &&
          "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <Video className="w-3 h-3" />
      {label}
    </button>
  );
}
