"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Lock } from "lucide-react";
import { getThumbnail } from "@/lib/clip-storage";
import { buildClipsByBaseName, matchSections, type MatchedSection, type ClipMetadata, HIGH_SPEED_THRESHOLD } from "@/lib/auto-match";
import { cn } from "@/lib/utils";
import { deriveBaseName } from "@/lib/broll";
import type { ParsedSection } from "@/lib/script-parser";
import { formatMs } from "@/lib/format-time";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface TimelinePreviewProps {
  timeline: MatchedSection[];
  productId: string;
  onTimelineChange: (t: MatchedSection[]) => void;
}

function MissingPanel({ timeline }: { timeline: MatchedSection[] }) {
  const missing = timeline
    .filter((s) => s.clips.some((c) => c.isPlaceholder))
    .reduce<Record<string, { count: number; totalMs: number }>>((acc, s) => {
      const key = s.tag;
      if (!acc[key]) acc[key] = { count: 0, totalMs: 0 };
      acc[key].count++;
      acc[key].totalMs += s.durationMs;
      return acc;
    }, {});

  if (Object.keys(missing).length === 0) return null;

  return (
    <div className="border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-4 text-sm">
      <p className="font-medium text-yellow-800 dark:text-yellow-300 mb-2">
        ⚠ {Object.keys(missing).length} tag{Object.keys(missing).length !== 1 ? "s" : ""} without B-roll matches (will render as black frames):
      </p>
      <ul className="space-y-0.5 text-yellow-700 dark:text-yellow-400">
        {Object.entries(missing).map(([tag, { count, totalMs }]) => (
          <li key={tag} className="font-mono text-xs">
            {tag} — {count} section{count !== 1 ? "s" : ""}, {formatMs(totalMs)} total
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimelinePreview({ timeline, productId, onTimelineChange }: TimelinePreviewProps) {
  const [confirmRerollIdx, setConfirmRerollIdx] = useState<number | null>(null);

  async function performReroll(sectionIndex: number) {
    const section = timeline[sectionIndex];
    const clipsRes = await fetch(`/api/products/${productId}/clips`);
    const rawClips = await clipsRes.json();
    const clips: ClipMetadata[] = rawClips.map((c: any) => ({
      ...c,
      baseName: deriveBaseName(c.brollName),
      createdAt: new Date(c.createdAt),
    }));
    const map = buildClipsByBaseName(clips);
    const fakeSection: ParsedSection = {
      lineNumber: sectionIndex + 1,
      startTime: 0,
      endTime: section.durationMs / 1000,
      tag: section.tag,
      scriptText: "",
      durationMs: section.durationMs,
    };
    const [rerolled] = matchSections([fakeSection], map);
    onTimelineChange(timeline.map((s, i) => (i === sectionIndex ? rerolled : s)));
  }

  function reroll(sectionIndex: number) {
    if (timeline[sectionIndex].userLocked) {
      setConfirmRerollIdx(sectionIndex);
      return;
    }
    void performReroll(sectionIndex);
  }

  return (
    <div className="space-y-4">
      <MissingPanel timeline={timeline} />

      <div className="space-y-2">
        {timeline.map((section, i) => {
          const maxSpeed = section.clips.length === 0
            ? 1
            : Math.max(...section.clips.map((c) => c.speedFactor));
          const isHighSpeed = maxSpeed > HIGH_SPEED_THRESHOLD;

          return (
            <div
              key={i}
              className={cn(
                "flex items-center gap-3 p-3 border rounded-lg",
                isHighSpeed && "border-yellow-500 bg-yellow-50/30 dark:bg-yellow-950/10",
                !isHighSpeed && "border-border",
              )}
            >
              <span className="text-xs font-mono w-6 text-muted-foreground">{i + 1}</span>
              <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">
                {section.tag}
              </span>
              {section.userLocked && (
                <span title="Manually set" className="shrink-0">
                  <Lock className="w-3.5 h-3.5 text-blue-500" />
                </span>
              )}
              {isHighSpeed && (
                <span
                  title={`Speed ${maxSpeed.toFixed(2)}× — may distort audio/frames`}
                  className="shrink-0"
                >
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                </span>
              )}
              <span className="text-xs text-muted-foreground shrink-0">{formatMs(section.durationMs)}</span>

              <div className="flex gap-1 flex-1 overflow-x-auto">
                {section.clips.map((clip, j) => (
                  <div key={j} className="w-10 h-12 border border-border rounded overflow-hidden shrink-0 relative bg-muted">
                    {clip.isPlaceholder ? (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">■</div>
                    ) : (
                      <ClipThumb clipId={clip.clipId} />
                    )}
                    {clip.speedFactor !== 1.0 && (
                      <div className="absolute bottom-0 left-0 right-0 text-center bg-black/60 text-white text-[8px]">
                        {clip.speedFactor.toFixed(1)}x
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={() => reroll(i)} className="shrink-0 text-muted-foreground hover:text-primary" title="Re-roll">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <Dialog
        open={confirmRerollIdx !== null}
        onOpenChange={(open) => { if (!open) setConfirmRerollIdx(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to auto-pick?</DialogTitle>
            <DialogDescription>
              This section was set manually. Re-rolling will replace your pick with a random variant.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRerollIdx(null)}>Cancel</Button>
            <Button
              onClick={() => {
                const idx = confirmRerollIdx;
                setConfirmRerollIdx(null);
                if (idx !== null) void performReroll(idx);
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClipThumb({ clipId }: { clipId: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    getThumbnail(clipId).then((buf) => {
      if (buf) setSrc(URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
    });
    return () => { if (src) URL.revokeObjectURL(src); };
  }, [clipId]);

  return src ? <img src={src} alt="" className="w-full h-full object-cover" /> : null;
}
