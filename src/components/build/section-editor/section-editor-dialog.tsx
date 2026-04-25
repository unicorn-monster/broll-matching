"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveBaseName } from "@/lib/broll";
import { formatMs } from "@/lib/format-time";
import {
  buildManualChain,
  computeChainSpeed,
  HIGH_SPEED_THRESHOLD,
  validateChain,
  type ClipMetadata,
  type MatchedClip,
  type MatchedSection,
} from "@/lib/auto-match";
import { VariantGrid } from "./variant-grid";
import { PreviewPane } from "./preview-pane";
import { ChainStrip } from "./chain-strip";

interface SectionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  section: MatchedSection;
  /** Map current clips array → ClipMetadata for initial picks. Caller passes an async resolver. */
  resolveSectionClips: (clips: MatchedClip[]) => Promise<ClipMetadata[]>;
  onSave: (newClips: MatchedClip[]) => void;
}

export function SectionEditorDialog({
  open,
  onOpenChange,
  productId,
  section,
  resolveSectionClips,
  onSave,
}: SectionEditorDialogProps) {
  const [variants, setVariants] = useState<ClipMetadata[]>([]);
  const [picks, setPicks] = useState<ClipMetadata[]>([]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [selectedClip, setSelectedClip] = useState<ClipMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  // Load variants + initial picks each time dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [variantsRes, initialPicks] = await Promise.all([
          fetch(`/api/products/${productId}/clips`).then((r) => r.json()),
          resolveSectionClips(section.clips),
        ]);
        if (cancelled) return;
        const allClips: ClipMetadata[] = variantsRes.map((c: any) => ({
          ...c,
          baseName: deriveBaseName(c.brollName),
          createdAt: new Date(c.createdAt),
        }));
        const tagKey = section.tag.toLowerCase();
        const filtered = allClips
          .filter((c) => deriveBaseName(c.brollName) === tagKey)
          .sort((a, b) => a.brollName.localeCompare(b.brollName));
        setVariants(filtered);
        setPicks(initialPicks);
        setActiveSlot(null);
        setSelectedClip(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, productId, section.tag, section.clips, resolveSectionClips]);

  const inChainIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);

  const chainDurations = picks.map((p) => p.durationMs);
  const speed = computeChainSpeed(chainDurations, section.durationMs);
  const validation = validateChain(chainDurations, section.durationMs);
  const isHighSpeed = speed > HIGH_SPEED_THRESHOLD;

  const totalMs = chainDurations.reduce((s, d) => s + d, 0);

  function handleSelectVariant(clip: ClipMetadata) {
    setSelectedClip(clip);
  }

  function handleUseInActiveSlot() {
    if (!selectedClip || activeSlot === null) return;
    if (activeSlot === picks.length) {
      // Add new slot
      setPicks([...picks, selectedClip]);
      setActiveSlot(null);
    } else {
      // Replace existing slot
      setPicks(picks.map((p, i) => (i === activeSlot ? selectedClip : p)));
      setActiveSlot(null);
    }
    setSelectedClip(null);
  }

  function handleRemoveSlot(slot: number) {
    setPicks(picks.filter((_, i) => i !== slot));
    if (activeSlot === slot) setActiveSlot(null);
    if (activeSlot !== null && activeSlot > slot) setActiveSlot(activeSlot - 1);
  }

  function handleSave() {
    if (validation && validation.code === "TOO_SLOW") return; // blocked
    const chain = buildManualChain(picks, section.durationMs);
    onSave(chain);
    onOpenChange(false);
  }

  const actionLabel =
    activeSlot === null
      ? "Select a slot first"
      : activeSlot === picks.length
        ? "Add to chain"
        : `Use for slot ${activeSlot + 1}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-[90vw] max-h-[90vh] flex flex-col gap-4"
      >
        <DialogHeader>
          <DialogTitle>Edit section: {section.tag} ({formatMs(section.durationMs)})</DialogTitle>
          <DialogDescription>
            Pick variants for each slot. System will speed up uniformly to fit section duration.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
        ) : (
          <>
            <ChainStrip
              picks={picks}
              activeSlot={activeSlot}
              onActivateSlot={(slot) => {
                setActiveSlot(slot);
                setSelectedClip(picks[slot] ?? null);
              }}
              onActivateAdd={() => {
                setActiveSlot(picks.length);
                setSelectedClip(null);
              }}
              onRemoveSlot={handleRemoveSlot}
            />

            <div className="grid grid-cols-[1fr_auto] gap-4 flex-1 min-h-0">
              <div className="min-h-0 overflow-y-auto">
                <VariantGrid
                  variants={variants}
                  selectedClipId={selectedClip?.id ?? null}
                  onSelect={handleSelectVariant}
                  inChainIds={inChainIds}
                />
              </div>
              <div className="w-[360px]">
                <PreviewPane
                  clip={selectedClip}
                  actionLabel={actionLabel}
                  actionDisabled={!selectedClip || activeSlot === null}
                  onUse={handleUseInActiveSlot}
                />
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-border pt-3">
          <div className="text-xs">
            <span className="text-muted-foreground">Chain total: </span>
            <span className="font-mono">{formatMs(totalMs)}</span>
            <span className="text-muted-foreground"> → </span>
            <span className={cn("font-mono", isHighSpeed && "text-yellow-600", validation?.code === "TOO_SLOW" && "text-red-500")}>
              {speed.toFixed(2)}× speed
            </span>
            {validation && (
              <span className="ml-2 text-red-500">{validation.message}</span>
            )}
            {!validation && isHighSpeed && (
              <span className="ml-2 text-yellow-600">Speed &gt;2× — may distort. Consider adding more clips.</span>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!!validation && validation.code === "TOO_SLOW"}
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
