"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChainStrip } from "@/components/build/section-editor/chain-strip";
import { VariantGrid } from "@/components/build/section-editor/variant-grid";
import { PreviewPane } from "@/components/build/section-editor/preview-pane";
import { useBuildState } from "@/components/build/build-state-context";
import { InspectorEmpty } from "./inspector-empty";
import { cn } from "@/lib/utils";
import { deriveBaseName } from "@/lib/broll";
import { formatMs } from "@/lib/format-time";
import {
  buildClipsByBaseName,
  buildManualChain,
  computeChainSpeed,
  HIGH_SPEED_THRESHOLD,
  matchSections,
  validateChain,
  type ClipMetadata,
  type MatchedClip,
} from "@/lib/auto-match";

interface InspectorPanelProps {
  productId: string;
}

export function InspectorPanel({ productId }: InspectorPanelProps) {
  const {
    inspectorMode,
    selectedSectionIndex,
    setSelectedSectionIndex,
    timeline,
    setTimeline,
  } = useBuildState();

  if (inspectorMode !== "section" || selectedSectionIndex === null || !timeline) {
    return <InspectorEmpty />;
  }

  return (
    <SectionEditor
      key={selectedSectionIndex}
      productId={productId}
      sectionIndex={selectedSectionIndex}
      onClose={() => setSelectedSectionIndex(null)}
      timeline={timeline}
      setTimeline={setTimeline}
    />
  );
}

function SectionEditor({
  productId,
  sectionIndex,
  onClose,
  timeline,
  setTimeline,
}: {
  productId: string;
  sectionIndex: number;
  onClose: () => void;
  timeline: ReturnType<typeof useBuildState>["timeline"];
  setTimeline: ReturnType<typeof useBuildState>["setTimeline"];
}) {
  const section = timeline![sectionIndex]!;

  const [variants, setVariants] = useState<ClipMetadata[]>([]);
  const [picks, setPicks] = useState<ClipMetadata[]>([]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [selectedClip, setSelectedClip] = useState<ClipMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/products/${productId}/clips`);
        if (!res.ok) throw new Error(`Failed to load clips (${res.status})`);
        const raw = (await res.json()) as Record<string, unknown>[];
        const all: ClipMetadata[] = raw.map(
          (c) =>
            ({
              ...(c as object),
              baseName: deriveBaseName(c.brollName as string),
              createdAt: new Date(c.createdAt as string),
            }) as ClipMetadata,
        );
        if (cancelled) return;
        const tag = section.tag.toLowerCase();
        setVariants(
          all
            .filter((c) => deriveBaseName(c.brollName) === tag)
            .sort((a, b) => a.brollName.localeCompare(b.brollName)),
        );
        const byId = new Map(all.map((c) => [c.id, c]));
        setPicks(
          section.clips.filter((c) => !c.isPlaceholder).flatMap((c) => {
            const m = byId.get(c.clipId);
            return m ? [m] : [];
          }),
        );
        setActiveSlot(null);
        setSelectedClip(null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, sectionIndex, section.tag, section.clips]);

  const inChainIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
  const { speed, validation, isHighSpeed, totalMs } = useMemo(() => {
    const durs = picks.map((p) => p.durationMs);
    const s = computeChainSpeed(durs, section.durationMs);
    return {
      speed: s,
      validation: validateChain(durs, section.durationMs),
      isHighSpeed: s > HIGH_SPEED_THRESHOLD,
      totalMs: durs.reduce((a, d) => a + d, 0),
    };
  }, [picks, section.durationMs]);

  function handleSelectVariant(clip: ClipMetadata) {
    setSelectedClip(clip);
  }
  function handleUseInActiveSlot() {
    if (!selectedClip || activeSlot === null) return;
    if (activeSlot === picks.length) setPicks([...picks, selectedClip]);
    else setPicks(picks.map((p, i) => (i === activeSlot ? selectedClip : p)));
    setActiveSlot(null);
    setSelectedClip(null);
  }
  function handleRemoveSlot(slot: number) {
    setPicks(picks.filter((_, i) => i !== slot));
    if (activeSlot === slot) setActiveSlot(null);
    if (activeSlot !== null && activeSlot > slot) setActiveSlot(activeSlot - 1);
  }
  function handleSave() {
    if (validation && validation.code === "TOO_SLOW") return;
    const chain = buildManualChain(picks, section.durationMs);
    persistChain(chain, true);
  }
  async function handleResetAuto() {
    const res = await fetch(`/api/products/${productId}/clips`);
    if (!res.ok) return;
    const raw = (await res.json()) as Record<string, unknown>[];
    const all: ClipMetadata[] = raw.map(
      (c) =>
        ({
          ...(c as object),
          baseName: deriveBaseName(c.brollName as string),
          createdAt: new Date(c.createdAt as string),
        }) as ClipMetadata,
    );
    const map = buildClipsByBaseName(all);
    const fakeParsed = {
      lineNumber: sectionIndex + 1,
      startTime: 0,
      endTime: section.durationMs / 1000,
      tag: section.tag,
      scriptText: "",
      durationMs: section.durationMs,
    };
    const [rerolled] = matchSections([fakeParsed], map);
    if (!rerolled) return;
    persistChain(rerolled.clips, false);
  }
  function persistChain(clips: MatchedClip[], userLocked: boolean) {
    setTimeline(timeline!.map((s, i) => (i === sectionIndex ? { ...s, clips, userLocked } : s)));
  }

  const actionLabel =
    activeSlot === null
      ? "Select a slot first"
      : activeSlot === picks.length
        ? "Add to chain"
        : `Use for slot ${activeSlot + 1}`;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-sm font-medium truncate">
          [{section.tag}] · {formatMs(section.durationMs)}
          {section.userLocked && <span className="ml-2 text-blue-400 text-xs">🔒</span>}
        </div>
        <button onClick={onClose} aria-label="Close inspector" className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : loadError ? (
        <div className="p-4 text-sm text-red-500">{loadError}</div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <ChainStrip
            picks={picks}
            activeSlot={activeSlot}
            onActivateSlot={(s) => {
              setActiveSlot(s);
              setSelectedClip(picks[s] ?? null);
            }}
            onActivateAdd={() => {
              setActiveSlot(picks.length);
              setSelectedClip(null);
            }}
            onRemoveSlot={handleRemoveSlot}
          />

          <div className="flex-1 min-h-0 overflow-hidden grid grid-rows-[1fr_auto]">
            <div className="overflow-y-auto p-2">
              <VariantGrid
                variants={variants}
                selectedClipId={selectedClip?.id ?? null}
                onSelect={handleSelectVariant}
                inChainIds={inChainIds}
              />
            </div>
            <div className="border-t border-border p-2 max-h-[280px] overflow-y-auto">
              <PreviewPane
                clip={selectedClip}
                actionLabel={actionLabel}
                actionDisabled={!selectedClip || activeSlot === null}
                onUse={handleUseInActiveSlot}
              />
            </div>
          </div>

          <div className="border-t border-border px-3 py-2 space-y-2">
            <div className="text-xs">
              <span className="text-muted-foreground">Chain: </span>
              <span className="font-mono">{formatMs(totalMs)}</span>
              <span className="text-muted-foreground"> → </span>
              <span
                className={cn(
                  "font-mono",
                  isHighSpeed && "text-yellow-500",
                  validation?.code === "TOO_SLOW" && "text-red-500",
                )}
              >
                {speed.toFixed(2)}× speed
              </span>
              {validation?.code === "TOO_SLOW" && (
                <p className="text-red-500 text-[11px] mt-1">{validation.message}</p>
              )}
              {!validation && isHighSpeed && (
                <p className="text-yellow-500 text-[11px] mt-1">Speed &gt;2× — may distort.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleResetAuto} className="flex-1">
                Reset auto
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!!validation && validation.code === "TOO_SLOW"}
                className="flex-1"
              >
                Save lock
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
