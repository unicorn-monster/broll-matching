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

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

interface QueueState {
  remaining: ClipMetadata[];
  lastUsed: ClipMetadata | null;
  fullPool: ClipMetadata[];
}

export interface MatchState {
  queues: Map<string, QueueState>;
  rng: () => number;
}

export function createMatchState(rng: () => number = Math.random): MatchState {
  return { queues: new Map(), rng };
}

function ensureQueue(state: MatchState, tagKey: string, fullPool: ClipMetadata[]): QueueState {
  let q = state.queues.get(tagKey);
  if (!q) {
    q = { remaining: shuffle([...fullPool], state.rng), lastUsed: null, fullPool };
    state.queues.set(tagKey, q);
  }
  return q;
}

function pickFromState(
  state: MatchState,
  tagKey: string,
  fullPool: ClipMetadata[],
  eligible: ClipMetadata[],
): ClipMetadata {
  const q = ensureQueue(state, tagKey, fullPool);
  const eligibleSet = new Set(eligible);

  for (let i = 0; i < q.remaining.length; i++) {
    if (eligibleSet.has(q.remaining[i]!)) {
      const picked = q.remaining.splice(i, 1)[0]!;
      q.lastUsed = picked;
      return picked;
    }
  }

  q.remaining = shuffle([...fullPool], state.rng);
  if (q.lastUsed && q.remaining.length >= 2 && q.remaining[0] === q.lastUsed) {
    [q.remaining[0], q.remaining[1]] = [q.remaining[1]!, q.remaining[0]!];
  }
  for (let i = 0; i < q.remaining.length; i++) {
    if (eligibleSet.has(q.remaining[i]!)) {
      const picked = q.remaining.splice(i, 1)[0]!;
      q.lastUsed = picked;
      return picked;
    }
  }

  const picked = eligible[Math.floor(state.rng() * eligible.length)]!;
  q.lastUsed = picked;
  return picked;
}

export function markUsed(
  state: MatchState,
  tagKey: string,
  fullPool: ClipMetadata[],
  clipId: string,
): void {
  const q = ensureQueue(state, tagKey, fullPool);
  const idx = q.remaining.findIndex((c) => c.id === clipId);
  if (idx >= 0) q.remaining.splice(idx, 1);
  const clip = fullPool.find((c) => c.id === clipId);
  if (clip) q.lastUsed = clip;
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

    // Trim-only: pick any clip with durationMs >= section.durationMs and trim from the start.
    // No speedup, no slowdown, no chaining — short clips are skipped to avoid distortion.
    const eligible = candidates.filter((c) => c.durationMs >= section.durationMs);
    if (eligible.length === 0) {
      warnings.push(`No B-roll long enough for tag: ${section.tag} (need ≥${section.durationMs}ms)`);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1, isPlaceholder: true }],
        warnings,
      };
    }

    const clip = pickRandom(eligible);
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
  });
}
