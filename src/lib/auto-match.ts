import { deriveBaseName } from "./broll";
import type { ParsedSection } from "./script-parser";

/** Synthetic fileId used for the singleton talking-head MP4 across all sliced clips. */
export const TALKING_HEAD_FILE_ID = "__talking_head__";

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
  fileId: string;
  folderId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface MatchedClip {
  clipId: string;
  fileId: string;
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
  /** Absolute seek-into-source position (ms). Set only on talking-head clips. */
  sourceSeekMs?: number;
}

export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  startMs: number;
  endMs: number;
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
    return [{ clipId: "placeholder", fileId: "", speedFactor: 1, isPlaceholder: true }];
  }
  const speedFactor = computeChainSpeed(
    picks.map((p) => p.durationMs),
    sectionMs,
  );
  return picks.map((p) => ({
    clipId: p.id,
    fileId: p.fileId,
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


/** Cap on the cooldown buffer length per tag. The effective cooldown is also bounded by
 *  pool size (`eligible.length - 1`) so we never starve sections when the pool is small. */
const MAX_COOLDOWN = 8;

interface QueueState {
  /** Most-recently-picked clipIds for this tag (index 0 = newest). Length ≤ MAX_COOLDOWN. */
  recent: string[];
}

export interface MatchState {
  queues: Map<string, QueueState>;
  /** Global pick count per clipId, used to bias toward least-used clips across the timeline. */
  usageCount: Map<string, number>;
  rng: () => number;
}

export function createMatchState(rng: () => number = Math.random): MatchState {
  return { queues: new Map(), usageCount: new Map(), rng };
}

function ensureQueue(state: MatchState, tagKey: string): QueueState {
  let q = state.queues.get(tagKey);
  if (!q) {
    q = { recent: [] };
    state.queues.set(tagKey, q);
  }
  return q;
}

function recordPick(state: MatchState, q: QueueState, clipId: string, cooldown: number): void {
  state.usageCount.set(clipId, (state.usageCount.get(clipId) ?? 0) + 1);
  q.recent.unshift(clipId);
  if (q.recent.length > cooldown) q.recent.length = cooldown;
}

/**
 * Picks one clip from `eligible` for a section, balancing three goals:
 *  1. Cooldown — avoid clips used in the last N picks for this tag (N = min(pool-1, MAX_COOLDOWN)).
 *  2. Least-used first — among non-cooling clips, prefer those with the lowest global usage count.
 *  3. Shortest-fit — among ties, prefer the clip whose duration is closest to the section length,
 *     so longer clips stay available for sections that actually need them.
 *  Final ties broken by `state.rng`. Cooldown is bypassed if it would leave nothing eligible.
 */
function pickFromState(
  state: MatchState,
  tagKey: string,
  eligible: ClipMetadata[],
): ClipMetadata {
  const q = ensureQueue(state, tagKey);
  const cooldown = Math.min(Math.max(eligible.length - 1, 0), MAX_COOLDOWN);

  const cooling = new Set(q.recent.slice(0, cooldown));
  let pool = eligible.filter((c) => !cooling.has(c.id));
  if (pool.length === 0) pool = eligible;

  let minUsage = Infinity;
  for (const c of pool) {
    const u = state.usageCount.get(c.id) ?? 0;
    if (u < minUsage) minUsage = u;
  }
  pool = pool.filter((c) => (state.usageCount.get(c.id) ?? 0) === minUsage);

  let minDur = Infinity;
  for (const c of pool) if (c.durationMs < minDur) minDur = c.durationMs;
  pool = pool.filter((c) => c.durationMs === minDur);

  const picked = pool[Math.floor(state.rng() * pool.length)]!;
  recordPick(state, q, picked.id, cooldown);
  return picked;
}

/**
 * Marks a clip as used externally (e.g. for a user-locked section preserved across re-paste).
 * Bumps both global usage count and the tag's cooldown buffer so subsequent auto-picks treat
 * the locked clip as if the matcher had picked it itself.
 */
export function markUsed(state: MatchState, tagKey: string, clipId: string): void {
  const q = ensureQueue(state, tagKey);
  recordPick(state, q, clipId, MAX_COOLDOWN);
}

export interface TalkingHeadConfig {
  fileId: string;
  /** Tag stored lowercase. Caller must normalise. */
  tag: string;
}

export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  state?: MatchState,
  talkingHead?: TalkingHeadConfig | null,
): MatchedSection[] {
  const s = state ?? createMatchState();
  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];
    // Carry the absolute audio-timeline position through to MatchedSection so
    // downstream consumers (timeline, render pipeline) can place B-roll clips at
    // the script-specified timestamps instead of accumulating a cursor from 0.
    const startMs = section.startTime * 1000;
    const endMs = section.endTime * 1000;

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, startMs, endMs, durationMs: 0, clips: [], warnings };
    }

    if (talkingHead && section.tag.toLowerCase() === talkingHead.tag) {
      return {
        sectionIndex,
        tag: section.tag,
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{
          clipId: "talking-head",
          fileId: talkingHead.fileId,
          speedFactor: 1,
          trimDurationMs: section.durationMs,
          sourceSeekMs: startMs,
          isPlaceholder: false,
        }],
        warnings,
      };
    }

    const key = section.tag.toLowerCase();
    const candidates = clipsByBaseName.get(key) ?? [];

    if (candidates.length === 0) {
      warnings.push(`No B-roll found for tag: ${section.tag}`);
      return {
        sectionIndex,
        tag: section.tag,
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", fileId: "", speedFactor: 1.0, isPlaceholder: true }],
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
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", fileId: "", speedFactor: 1, isPlaceholder: true }],
        warnings,
      };
    }

    const clip = pickFromState(s, key, eligible);
    return {
      sectionIndex,
      tag: section.tag,
      startMs,
      endMs,
      durationMs: section.durationMs,
      clips: [{
        clipId: clip.id,
        fileId: clip.fileId,
        speedFactor: 1,
        trimDurationMs: section.durationMs,
        isPlaceholder: false,
      }],
      warnings,
    };
  });
}
