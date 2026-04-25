import { deriveBaseName } from "./broll";
import type { ParsedSection } from "./script-parser";

/** Sections with any clip whose speedFactor exceeds this get a visual warning. */
export const HIGH_SPEED_THRESHOLD = 2.0;

/** Minimum allowed speedFactor when user manually builds a chain. Below this, save is rejected. */
export const MIN_SPEED_FACTOR = 0.8;

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

    // Case 1: at least one clip is long enough — single clip, speed up or keep 1x (never slow).
    const longEnough = candidates.filter((c) => c.durationMs >= section.durationMs);
    if (longEnough.length > 0) {
      const clip = pickRandom(longEnough);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [singleClipMatch(clip, section.durationMs)],
        warnings,
      };
    }

    // Case 2: no single clip fits — chain clips until total >= section, speed up all uniformly.
    // Every candidate here has duration < section.durationMs, so the overshoot < section.durationMs,
    // making the resulting speedFactor strictly < 2.0 (no cap/trim needed).
    const chain: ClipMetadata[] = [];
    let totalMs = 0;
    let lastClip: ClipMetadata | undefined;
    while (totalMs < section.durationMs) {
      const clip = pickRandom(candidates, lastClip);
      chain.push(clip);
      lastClip = clip;
      totalMs += clip.durationMs;
    }

    const speedFactor = totalMs / section.durationMs;
    return {
      sectionIndex,
      tag: section.tag,
      durationMs: section.durationMs,
      clips: chain.map((c) => ({
        clipId: c.id,
        indexeddbKey: c.indexeddbKey,
        speedFactor,
        isPlaceholder: false,
      })),
      warnings,
    };
  });
}
