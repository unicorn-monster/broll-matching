"use client";

import { useEffect, useState, useRef } from "react";
import { RefreshCw, ArrowLeftRight, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getThumbnail } from "@/lib/clip-storage";
import {
  PLACEHOLDER_CLIP_ID,
  type ClipMetadata,
  type MatchedSection,
} from "@/lib/auto-match";
import type { ParsedSection } from "@/lib/script-parser";

// ---------------------------------------------------------------------------
// Tag colour palette
// ---------------------------------------------------------------------------

const TAG_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-400",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400",
];

function tagColorClass(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Thumbnail hook (blob URL lifecycle managed per-mount)
// ---------------------------------------------------------------------------

function useThumbnailUrl(clipId: string | null): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const urlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!clipId || clipId === PLACEHOLDER_CLIP_ID) return;
    let cancelled = false;
    getThumbnail(clipId).then((data) => {
      if (cancelled || !data) return;
      const blob = new Blob([data], { type: "image/jpeg" });
      const objectUrl = URL.createObjectURL(blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = undefined;
      }
    };
  }, [clipId]);

  return url;
}

// ---------------------------------------------------------------------------
// Swap Dialog
// ---------------------------------------------------------------------------

interface SwapDialogProps {
  open: boolean;
  onClose: () => void;
  tagName: string;
  clips: ClipMetadata[];
  onSelect: (clip: ClipMetadata) => void;
}

function SwapThumbnail({
  clip,
  onSelect,
}: {
  clip: ClipMetadata;
  onSelect: () => void;
}) {
  const url = useThumbnailUrl(clip.id);
  return (
    <button
      className="relative aspect-[9/16] rounded-md overflow-hidden bg-muted border border-border hover:border-foreground transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onSelect}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Film className="w-5 h-5 text-muted-foreground/40" />
        </div>
      )}
      <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1 py-0.5 rounded">
        {formatDuration(clip.durationMs)}
      </div>
    </button>
  );
}

function SwapDialog({ open, onClose, tagName, clips, onSelect }: SwapDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Swap clip — {tagName}</DialogTitle>
        </DialogHeader>
        {clips.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No clips available for this tag.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto py-2">
            {clips.map((clip) => (
              <SwapThumbnail
                key={clip.id}
                clip={clip}
                onSelect={() => {
                  onSelect(clip);
                  onClose();
                }}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Section row
// ---------------------------------------------------------------------------

interface SectionRowProps {
  section: ParsedSection;
  matched: MatchedSection;
  clipsByTag: Map<string, ClipMetadata[]>;
  onReroll: () => void;
  onSwap: (clip: ClipMetadata) => void;
}

function SectionRow({ section, matched, clipsByTag, onReroll, onSwap }: SectionRowProps) {
  const [swapOpen, setSwapOpen] = useState(false);
  const colorClass = tagColorClass(section.tag);

  // Available clips for this tag (for swap dialog)
  const needle = section.tag.toLowerCase();
  let tagClips: ClipMetadata[] = [];
  for (const [key, clips] of clipsByTag) {
    if (key.toLowerCase() === needle) {
      tagClips = clips;
      break;
    }
  }

  // First clip in the matched section (for thumbnail preview)
  const firstClip = matched.clips[0];
  const firstClipId =
    firstClip && !firstClip.isPlaceholder ? firstClip.clipId : null;
  const thumbnailUrl = useThumbnailUrl(firstClipId);

  return (
    <div className="flex gap-3 p-3 rounded-lg border border-border bg-background">
      {/* Thumbnail */}
      <div className="shrink-0 w-12 aspect-[9/16] rounded overflow-hidden bg-muted border border-border">
        {firstClip?.isPlaceholder ? (
          <div className="w-full h-full flex items-center justify-center bg-black">
            <span className="text-[9px] text-white/50 leading-none text-center px-1">
              black
            </span>
          </div>
        ) : thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-4 h-4 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${colorClass}`}
          >
            {section.tag}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(section.startTime)} – {formatTimestamp(section.endTime)}
          </span>
        </div>

        {/* Clip badges */}
        <div className="flex flex-wrap gap-1">
          {matched.clips.length === 0 && (
            <span className="text-xs text-muted-foreground italic">no clips</span>
          )}
          {matched.clips.map((mc, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px]"
            >
              {mc.isPlaceholder ? (
                <span className="text-muted-foreground">placeholder</span>
              ) : (
                <>
                  <span className="text-muted-foreground">clip {i + 1}</span>
                  {mc.speedFactor !== 1.0 && (
                    <span className="font-semibold text-foreground">
                      {mc.speedFactor.toFixed(2)}×
                    </span>
                  )}
                  {mc.trimDurationMs && (
                    <span className="text-muted-foreground">
                      trim {formatDuration(mc.trimDurationMs)}
                    </span>
                  )}
                </>
              )}
            </span>
          ))}
        </div>

        {/* Warnings */}
        {matched.warnings.map((w, i) => (
          <p key={i} className="text-[11px] text-yellow-600 dark:text-yellow-400">
            {w}
          </p>
        ))}
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-col gap-1.5 justify-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Re-roll clips"
          onClick={onReroll}
          disabled={tagClips.length === 0}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Swap clip"
          onClick={() => setSwapOpen(true)}
          disabled={tagClips.length === 0}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      <SwapDialog
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        tagName={section.tag}
        clips={tagClips}
        onSelect={onSwap}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface TimelinePreviewProps {
  sections: ParsedSection[];
  matchedSections: MatchedSection[];
  clipsByTag: Map<string, ClipMetadata[]>;
  onReroll: (sectionIndex: number) => void;
  onSwap: (sectionIndex: number, clip: ClipMetadata) => void;
}

export function TimelinePreview({
  sections,
  matchedSections,
  clipsByTag,
  onReroll,
  onSwap,
}: TimelinePreviewProps) {
  const matchedMap = new Map(matchedSections.map((m) => [m.sectionIndex, m]));

  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Parse a script in Step 2 to see the timeline.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section, i) => {
        const matched = matchedMap.get(i);
        if (!matched) return null;
        return (
          <SectionRow
            key={i}
            section={section}
            matched={matched}
            clipsByTag={clipsByTag}
            onReroll={() => onReroll(i)}
            onSwap={(clip) => onSwap(i, clip)}
          />
        );
      })}
    </div>
  );
}

// Export helper for build-video to use
export { tagColorClass };
