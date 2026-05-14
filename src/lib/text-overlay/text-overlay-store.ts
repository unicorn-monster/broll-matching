import type { OverlayItem, TextOverlay } from "@/lib/overlay/overlay-types";
import type { ParsedSection } from "@/lib/script-parser";
import type { TextStyle } from "./text-overlay-types";
import {
  TEXT_OVERLAY_DEFAULT_DURATION_MS,
  TEXT_OVERLAY_DEFAULT_TRACK_INDEX,
  TEXT_OVERLAY_LEAD_MS,
} from "./text-style-defaults";
import { wrapTextToLines } from "./text-overlay-render";

// Shifts a (start, duration) interval earlier by TEXT_OVERLAY_LEAD_MS without changing its
// duration. Clamps startMs to 0 (first caption may end up showing slightly less of its
// "lead" if the section starts at t=0).
function applyLead(startMs: number, durationMs: number): { startMs: number; durationMs: number } {
  const shifted = startMs - TEXT_OVERLAY_LEAD_MS;
  if (shifted >= 0) return { startMs: shifted, durationMs };
  // First section: keep original startMs at 0; durationMs is shortened to keep endMs the same
  // as it would have been (originalEnd = startMs + durationMs; new end = shifted + durationMs
  // = originalEnd - lead; clamping start to 0 → duration = originalEnd - lead - 0).
  const originalEnd = startMs + durationMs;
  return { startMs: 0, durationMs: Math.max(0, originalEnd - TEXT_OVERLAY_LEAD_MS) };
}

export interface GenerateOptions {
  // Line numbers to exclude from caption generation (e.g. sections whose b-roll didn't match).
  skipLineNumbers?: Set<number>;
}

export const MAX_LINES_PER_OVERLAY = 2;

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
  options: GenerateOptions = {},
): TextOverlay[] {
  const skip = options.skipLineNumbers ?? new Set<number>();
  return sections
    .filter((s) => s.scriptText.trim().length > 0 && !skip.has(s.lineNumber))
    .map((s) => {
      const shifted = applyLead(Math.round(s.startTime * 1000), s.durationMs);
      return makeTextOverlay({
        startMs: shifted.startMs,
        durationMs: shifted.durationMs,
        text: s.scriptText,
        source: "auto-script",
        sectionLineNumber: s.lineNumber,
        style,
      });
    });
}

export type MergeMode = "replace" | "merge";

export function mergeCaptions(
  overlays: OverlayItem[],
  sections: ParsedSection[],
  style: TextStyle,
  mode: MergeMode,
  options: GenerateOptions = {},
): OverlayItem[] {
  const skip = options.skipLineNumbers ?? new Set<number>();
  const nonText = overlays.filter((o) => o.kind !== "text");
  const text = overlays.filter((o): o is TextOverlay => o.kind === "text");
  const manuals = text.filter((t) => t.source === "manual");

  if (mode === "replace") {
    const fresh = generateFromSections(sections, style, options);
    return [...nonText, ...fresh, ...manuals];
  }
  // mode === "merge" — keep ALL existing auto overlays for any sectionLineNumber that already has one
  // (so splits made via splitIntoMaxLines and any user edits are preserved). New sections get a single overlay.
  const existingByLine = new Map<number, TextOverlay[]>();
  for (const t of text) {
    if (t.source === "auto-script" && t.sectionLineNumber !== undefined) {
      const arr = existingByLine.get(t.sectionLineNumber) ?? [];
      arr.push(t);
      existingByLine.set(t.sectionLineNumber, arr);
    }
  }
  const merged: TextOverlay[] = [];
  for (const s of sections) {
    if (s.scriptText.trim().length === 0) continue;
    if (skip.has(s.lineNumber)) continue;
    const priors = existingByLine.get(s.lineNumber);
    if (priors && priors.length > 0) {
      merged.push(...priors);
    } else {
      const shifted = applyLead(Math.round(s.startTime * 1000), s.durationMs);
      merged.push(
        makeTextOverlay({
          startMs: shifted.startMs,
          durationMs: shifted.durationMs,
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

// Splits text into roughly N equal-word chunks at word boundaries. Last chunk may be
// slightly shorter (or longer by up to one word).
function splitTextBalanced(text: string, nChunks: number): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (nChunks <= 1 || words.length <= nChunks) return [text.trim()];
  const wordsPerChunk = Math.ceil(words.length / nChunks);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return chunks;
}

// Splits any TextOverlay whose wrapped line count exceeds `maxLines` into multiple overlays.
// Uses BALANCED word-count split (not line-count) so chunks have similar text length and
// avoid orphan chunks with only one word. Each resulting chunk should wrap to ≤ maxLines.
// Duration is divided proportionally by character count. Manual overlays and non-text
// overlays pass through unchanged.
export function splitIntoMaxLines(
  overlays: OverlayItem[],
  ctx: CanvasRenderingContext2D,
  refOutputWidthPx: number,
  refOutputHeightPx: number,
  maxLines: number = MAX_LINES_PER_OVERLAY,
): OverlayItem[] {
  const out: OverlayItem[] = [];
  for (const o of overlays) {
    if (o.kind !== "text") { out.push(o); continue; }
    const fontSizePx = Math.round(o.fontSizeFrac * refOutputHeightPx);
    const paddingXPx = Math.round(o.bgPaddingXFrac * refOutputWidthPx);
    const maxTextWidthPx = Math.round(o.maxWidthFrac * refOutputWidthPx) - 2 * paddingXPx;
    ctx.font = `${o.fontWeight} ${fontSizePx}px "${o.fontFamily}", sans-serif`;
    const lines = wrapTextToLines(ctx, o.text, Math.max(10, maxTextWidthPx));
    if (lines.length <= maxLines) { out.push(o); continue; }

    const nChunks = Math.ceil(lines.length / maxLines);
    const chunkTexts = splitTextBalanced(o.text, nChunks);
    const totalChars = chunkTexts.reduce((s, t) => s + t.length, 0) || 1;

    let cursor = o.startMs;
    const endMs = o.startMs + o.durationMs;
    for (let i = 0; i < chunkTexts.length; i++) {
      const chunkText = chunkTexts[i]!;
      const isLast = i === chunkTexts.length - 1;
      const proposed = Math.round(o.durationMs * (chunkText.length / totalChars));
      const dur = isLast ? endMs - cursor : proposed;
      out.push({
        ...o,
        // Chunk 0 keeps the original overlay's id so selection / external references survive
        // a re-split. Subsequent chunks get fresh ids.
        id: i === 0 ? o.id : newId(),
        startMs: cursor,
        durationMs: dur,
        text: chunkText,
      });
      cursor += dur;
    }
  }
  return out;
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
