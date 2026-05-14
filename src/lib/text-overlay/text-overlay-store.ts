import type { OverlayItem, TextOverlay } from "@/lib/overlay/overlay-types";
import type { ParsedSection } from "@/lib/script-parser";
import type { TextStyle } from "./text-overlay-types";
import {
  TEXT_OVERLAY_DEFAULT_DURATION_MS,
  TEXT_OVERLAY_DEFAULT_TRACK_INDEX,
} from "./text-style-defaults";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function makeTextOverlay(args: {
  id?: string;
  startMs: number;
  durationMs: number;
  text: string;
  source: TextOverlay["source"];
  sectionLineNumber?: number;
  style: TextStyle;
}): TextOverlay {
  return {
    id: args.id ?? newId(),
    kind: "text",
    trackIndex: TEXT_OVERLAY_DEFAULT_TRACK_INDEX,
    startMs: args.startMs,
    durationMs: args.durationMs,
    volume: 1,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0,
    text: args.text,
    source: args.source,
    ...(args.sectionLineNumber !== undefined ? { sectionLineNumber: args.sectionLineNumber } : {}),
    ...args.style,
  };
}

export function generateFromSections(
  sections: ParsedSection[],
  style: TextStyle,
): TextOverlay[] {
  return sections
    .filter((s) => s.scriptText.trim().length > 0)
    .map((s) =>
      makeTextOverlay({
        startMs: Math.round(s.startTime * 1000),
        durationMs: s.durationMs,
        text: s.scriptText,
        source: "auto-script",
        sectionLineNumber: s.lineNumber,
        style,
      }),
    );
}

export type MergeMode = "replace" | "merge";

export function mergeCaptions(
  overlays: OverlayItem[],
  sections: ParsedSection[],
  style: TextStyle,
  mode: MergeMode,
): OverlayItem[] {
  const nonText = overlays.filter((o) => o.kind !== "text");
  const text = overlays.filter((o): o is TextOverlay => o.kind === "text");
  const manuals = text.filter((t) => t.source === "manual");

  if (mode === "replace") {
    const fresh = generateFromSections(sections, style);
    return [...nonText, ...fresh, ...manuals];
  }
  // mode === "merge"
  const existingAutoByLine = new Map<number, TextOverlay>();
  for (const t of text) {
    if (t.source === "auto-script" && t.sectionLineNumber !== undefined) {
      existingAutoByLine.set(t.sectionLineNumber, t);
    }
  }
  const merged: TextOverlay[] = [];
  for (const s of sections) {
    if (s.scriptText.trim().length === 0) continue;
    const prior = existingAutoByLine.get(s.lineNumber);
    if (prior) {
      merged.push({
        ...prior,
        startMs: Math.round(s.startTime * 1000),
        durationMs: s.durationMs,
      });
    } else {
      merged.push(
        makeTextOverlay({
          startMs: Math.round(s.startTime * 1000),
          durationMs: s.durationMs,
          text: s.scriptText,
          source: "auto-script",
          sectionLineNumber: s.lineNumber,
          style,
        }),
      );
    }
  }
  return [...nonText, ...merged, ...manuals];
}

export function addManualTextOverlay(
  overlays: OverlayItem[],
  atMs: number,
  style: TextStyle,
): OverlayItem[] {
  const inserted = makeTextOverlay({
    startMs: atMs,
    durationMs: TEXT_OVERLAY_DEFAULT_DURATION_MS,
    text: "",
    source: "manual",
    style,
  });
  return [...overlays, inserted];
}

export function applyStyleToAll(
  overlays: OverlayItem[],
  patch: Partial<TextStyle>,
): OverlayItem[] {
  return overlays.map((o) => (o.kind === "text" ? { ...o, ...patch } : o));
}

export function removeTextOverlay(overlays: OverlayItem[], id: string): OverlayItem[] {
  return overlays.filter((o) => o.id !== id);
}

export interface Interval { startMs: number; durationMs: number }

// Adjusts (startMs, durationMs) so the moved interval does not overlap any other text overlay.
// Strategy: if the moved interval intersects a neighbor, push it left or right so it just
// touches the neighbor's edge. Duration is preserved.
export function snapToNeighbor(
  moved: Interval,
  movedId: string,
  others: TextOverlay[],
): Interval {
  const movedEnd = moved.startMs + moved.durationMs;
  for (const o of others) {
    if (o.id === movedId) continue;
    const oEnd = o.startMs + o.durationMs;
    const overlaps = moved.startMs < oEnd && o.startMs < movedEnd;
    if (!overlaps) continue;
    const movedCenter = moved.startMs + moved.durationMs / 2;
    const oCenter = o.startMs + o.durationMs / 2;
    if (movedCenter <= oCenter) {
      return { startMs: Math.max(0, o.startMs - moved.durationMs), durationMs: moved.durationMs };
    } else {
      return { startMs: oEnd, durationMs: moved.durationMs };
    }
  }
  return moved;
}
