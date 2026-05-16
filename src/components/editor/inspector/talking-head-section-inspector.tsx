"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { formatMs } from "@/lib/format-time";
import type { MatchedSection } from "@/lib/auto-match";

interface Props {
  selectedSection: MatchedSection;
  playerSeekRef: MutableRefObject<((ms: number) => void) | null>;
}

export function TalkingHeadSectionInspector({ selectedSection, playerSeekRef }: Props) {
  const { talkingHeadLayers, renameTalkingHeadLayer, removeTalkingHeadLayer } = useBuildState();
  const layer = talkingHeadLayers.find((l) => l.tag === selectedSection.tag.toLowerCase());

  const [editing, setEditing] = useState(false);
  const [draftTag, setDraftTag] = useState(layer?.tag ?? "");
  const [error, setError] = useState<string | null>(null);

  // Sync draft when layer or section changes.
  useEffect(() => {
    setEditing(false);
    setDraftTag(layer?.tag ?? "");
    setError(null);
  }, [layer?.id, layer?.tag]);

  function commitRename() {
    if (!layer) return;
    const trimmed = draftTag.trim();
    if (trimmed === layer.tag) {
      setEditing(false);
      return;
    }
    if (trimmed.length === 0) {
      setError("Tag cannot be empty.");
      return;
    }
    const result = renameTalkingHeadLayer(layer.id, draftTag);
    if (!result.ok) {
      setError(
        result.reason === "duplicate-tag"
          ? "Tag already in use."
          : result.reason === "empty-tag"
            ? "Tag cannot be empty."
            : "Cannot rename.",
      );
      return;
    }
    setError(null);
    setEditing(false);
  }

  return (
    <div className="h-full p-4 space-y-3">
      <div className="rounded-md border border-purple-500/40 bg-purple-500/5 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-purple-300">Talking-head slice</div>
          {layer && (
            <button
              onClick={() => removeTalkingHeadLayer(layer.id)}
              className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10"
              title={`Delete layer "${layer.tag}"`}
              aria-label={`Delete layer ${layer.tag}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Layer tag — view / rename inline */}
        {layer ? (
          editing ? (
            <div className="flex items-center gap-1">
              <input
                value={draftTag}
                onChange={(e) => setDraftTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setDraftTag(layer.tag);
                    setError(null);
                  }
                }}
                autoFocus
                className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded font-mono"
              />
              <button
                onClick={commitRename}
                className="p-1 text-green-400 hover:bg-green-500/10 rounded"
                aria-label="Confirm rename"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setDraftTag(layer.tag);
                  setError(null);
                }}
                className="p-1 text-muted-foreground hover:bg-muted rounded"
                aria-label="Cancel rename"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full flex items-center justify-between px-2 py-1 text-[11px] text-purple-200 bg-background/40 rounded hover:bg-background/60 transition"
              title="Click to rename this layer"
            >
              <span className="font-mono">Layer: {layer.tag}</span>
              <Pencil className="w-3 h-3 opacity-60" />
            </button>
          )
        ) : (
          <div className="text-[10px] text-muted-foreground italic">Layer: (unknown)</div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}

        <div className="text-xs text-muted-foreground tabular-nums">
          {formatMs(selectedSection.startMs)} → {formatMs(selectedSection.endMs)}{" "}
          ({(selectedSection.durationMs / 1000).toFixed(2)}s)
        </div>
        <Button
          size="sm"
          variant="outline"
          // eslint-disable-next-line react-hooks/refs
          onClick={() => playerSeekRef.current?.(selectedSection.startMs)}
        >
          Preview slice
        </Button>
      </div>
    </div>
  );
}
