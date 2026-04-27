import { deriveBaseName } from "./broll";
import type { ParsedSection } from "./script-parser";

/** Sections with any clip whose speedFactor exceeds this get a visual warning. */
export const HIGH_SPEED_THRESHOLD = 2.0;

/** Minimum allowed speedFactor when user manually builds a chain. Below this, save is rejected. */
export const MIN_SPEED_FACTOR = 0.8;

/** Auto-match Case 1 caps speed-up at this factor; above this we trim instead. */
export const MAX_AUTO_SPEEDUP = 1.3;

/** Auto-match Case 2 always picks exactly this many clips into a chain. */
export const CHAIN_PAIR_SIZE = 2;

/**
 * Pure helper: returns the uniform speedFactor a chain of clips will play at to fit `sectionMs`.
 * speed = sum(clip durations) / sectionMs. Returns 0 for an empty chain so callers can detect it.
 */
export function computeChainSpeed(chainDurations: number[], sectionMs: number): number {
  if (chainDurations.length === 0) return 0;
  const total = chainDurations.reduce((sum, d) => sum + d, 0);
  return total / sectionMs;
}

export interface ChainValidationError {
  code: "EMPTY" | "TOO_SLOW";
  message: string;
}

/**
 * Validates a manually-built chain. Returns null if acceptable, or an error describing
 * why the chain cannot be saved (empty, or below MIN_SPEED_FACTOR slow-down floor).
 * No upper cap — users may speed up freely (HIGH_SPEED_THRESHOLD is a UI warning, not a block).
 */
export function validateChain(
  chainDurations: number[],
  sectionMs: number,
): ChainValidationError | null {
  if (chainDurations.length === 0) {
    return { code: "EMPTY", message: "Chain is empty. Add at least one clip." };
  }
  const speed = computeChainSpeed(chainDurations, sectionMs);
  if (speed < MIN_SPEED_FACTOR) {
    return {
      code: "TOO_SLOW",
      message: `Chain too short. Add another clip or pick a longer variant (current speed ${speed.toFixed(2)}× < ${MIN_SPEED_FACTOR}×).`,
    };
  }
  return null;
}

export interface ClipMetadata {
  id: string;
  brollName: string;
  baseName: string;
  durationMs: number;
  indexeddbKey: string;
  folderId: string;
  productId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface MatchedClip {
  clipId: string;
  indexeddbKey: string;
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
}

export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
  userLocked?: boolean;
}

/**
 * Builds a MatchedClip[] from a user-curated ordered list of clips for one section.
 * All picks share a uniform speedFactor so the chain plays end-to-end in `sectionMs`.
 * Returns a single placeholder (speedFactor 1, isPlaceholder true) when no picks given —
 * matches the placeholder shape produced by `matchSections` for tagless sections so
 * downstream renderers handle both paths identically.
 */
export function buildManualChain(picks: ClipMetadata[], sectionMs: number): MatchedClip[] {
  if (picks.length === 0) {
    return [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1, isPlaceholder: true }];
  }
  const speedFactor = computeChainSpeed(
    picks.map((p) => p.durationMs),
    sectionMs,
  );
  return picks.map((p) => ({
    clipId: p.id,
    indexeddbKey: p.indexeddbKey,
    speedFactor,
    isPlaceholder: false,
  }));
}

export function buildClipsByBaseName(clips: ClipMetadata[]): Map<string, ClipMetadata[]> {
  const map = new Map<string, ClipMetadata[]>();
  for (const clip of clips) {
    const key = deriveBaseName(clip.brollName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(clip);
  }
  return map;
}

function pickRandom<T>(arr: T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  const choices = avoid ? arr.filter((x) => x !== avoid) : arr;
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : arr[0];
}

/** Pick two distinct elements from an array. Caller must guarantee arr.length >= 2. */
function pickTwoDistinct<T>(arr: T[]): [T, T] {
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * (arr.length - 1));
  if (j >= i) j += 1;
  return [arr[i]!, arr[j]!];
}

function singleClipMatch(clip: ClipMetadata, sectionMs: number): MatchedClip {
  // Precondition: clip.durationMs >= sectionMs, so speedFactor >= 1.0 (never slows).
  const speedFactor = clip.durationMs / sectionMs;
  return { clipId: clip.id, indexeddbKey: clip.indexeddbKey, speedFactor, isPlaceholder: false };
}

export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
): MatchedSection[] {
  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, durationMs: 0, clips: [], warnings };
    }

    const key = section.tag.toLowerCase();
    const candidates = clipsByBaseName.get(key) ?? [];

    if (candidates.length === 0) {
      warnings.push(`No B-roll found for tag: ${section.tag}`);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1.0, isPlaceholder: true }],
        warnings,
      };
    }

    // Case 1: at least one clip is long enough — speedup if natural ratio <= MAX_AUTO_SPEEDUP,
    // otherwise trim a longer clip down to section length and play at 1x.
    const longEnough = candidates.filter((c) => c.durationMs >= section.durationMs);
    if (longEnough.length > 0) {
      const speedupOk = longEnough.filter(
        (c) => c.durationMs / section.durationMs <= MAX_AUTO_SPEEDUP,
      );
      if (speedupOk.length > 0) {
        const clip = pickRandom(speedupOk);
        return {
          sectionIndex,
          tag: section.tag,
          durationMs: section.durationMs,
          clips: [singleClipMatch(clip, section.durationMs)],
          warnings,
        };
      }
      // Trim fallback: speedFactor stays 1, source is cut to section length.
      const clip = pickRandom(longEnough);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{
          clipId: clip.id,
          indexeddbKey: clip.indexeddbKey,
          speedFactor: 1,
          trimDurationMs: section.durationMs,
          isPlaceholder: false,
        }],
        warnings,
      };
    }

    // Case 2: no single clip fits the section — pick exactly CHAIN_PAIR_SIZE distinct
    // candidates and adjust the shared speedFactor to fit. No cap, no floor.
    if (candidates.length < CHAIN_PAIR_SIZE) {
      warnings.push(`Need ≥${CHAIN_PAIR_SIZE} variants for chain mode (tag: ${section.tag})`);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1, isPlaceholder: true }],
        warnings,
      };
    }

    const [clipA, clipB] = pickTwoDistinct(candidates);
    const totalMs = clipA.durationMs + clipB.durationMs;
    const speedFactor = totalMs / section.durationMs;
    return {
      sectionIndex,
      tag: section.tag,
      durationMs: section.durationMs,
      clips: [
        { clipId: clipA.id, indexeddbKey: clipA.indexeddbKey, speedFactor, isPlaceholder: false },
        { clipId: clipB.id, indexeddbKey: clipB.indexeddbKey, speedFactor, isPlaceholder: false },
      ],
      warnings,
    };
  });
}
