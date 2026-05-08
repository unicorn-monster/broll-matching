"use client";

import { FileText } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { cn } from "@/lib/utils";

export function ScriptPill() {
  const { sections, setScriptDialogOpen } = useBuildState();
  const ready = !!sections && sections.length > 0;

  return (
    <button
      type="button"
      onClick={() => setScriptDialogOpen(true)}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition",
        ready
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20"
          : "bg-amber-500/10 border-amber-500/40 text-amber-300 hover:bg-amber-500/20",
      )}
    >
      <FileText className="w-3 h-3" />
      {ready ? `${sections!.length} sections` : "Script: not set"}
    </button>
  );
}
