"use client";

import { useBuildState } from "@/components/build/build-state-context";

export function InspectorEmpty() {
  const { timeline } = useBuildState();
  if (!timeline) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Set audio + paste script to begin.
      </div>
    );
  }
  const totalSections = timeline.length;
  const matched = timeline.filter((s) => s.clips.every((c) => !c.isPlaceholder)).length;
  const locked = timeline.filter((s) => s.userLocked).length;
  const highSpeed = timeline.filter(
    (s) => s.clips.some((c) => c.speedFactor > 2.0),
  ).length;

  return (
    <div className="p-4 text-sm space-y-3">
      <p className="text-muted-foreground">Click a section in the timeline to edit it.</p>
      <ul className="text-xs space-y-1">
        <li><span className="font-mono">{matched}/{totalSections}</span> sections matched</li>
        <li><span className="font-mono">{locked}</span> locked</li>
        <li><span className="font-mono">{highSpeed}</span> high-speed warnings</li>
      </ul>
    </div>
  );
}
