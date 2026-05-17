import { deriveBaseName } from "./broll";
import { sectionKey } from "./matting/section-key";
import { OVERLAY_TAG, type ParsedSection } from "./script-parser";
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

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
  /** True when this clip is the matted overlay layered on top of the base clip. */
  isOverlay?: boolean;
}

export interface MatchedSection {
  sectionIndex: number;
  /** First base tag (excluding overlay tag), kept for back-compat UI labels. */
  tag: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  clips: MatchedClip[];
  /** Overlay clip layered on top of `clips`; present only when section opts into overlay. */
  overlayClip?: MatchedClip;
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

/** Pick strategy controls how `pickFromState` reduces the eligible pool after cooldown.
 *  - `balanced` (default, initial auto-match): least-used + shortest-fit + random tie-break.
 *    Goal: even clip distribution and reserve longer clips for sections that need them.
 *  - `varied` (shuffle re-roll): pure random from cooldown-filtered pool. Drops least-used
 *    and shortest-fit because those biases make picks near-deterministic across re-rolls. */
export type PickStrategy = "balanced" | "varied";

export interface MatchState {
  queues: Map<string, QueueState>;
  /** Global pick count per clipId, used to bias toward least-used clips across the timeline. */
  usageCount: Map<string, number>;
  rng: () => number;
  pickStrategy: PickStrategy;
}

export function createMatchState(
  rng: () => number = Math.random,
  pickStrategy: PickStrategy = "balanced",
): MatchState {
  return { queues: new Map(), usageCount: new Map(), rng, pickStrategy };
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
 * Picks one clip from `eligible` for a section. Cooldown always applies. The remaining
 * pool reduction depends on `state.pickStrategy`:
 *  - `balanced`: least-used → shortest-fit → random tie-break (initial auto-match).
 *  - `varied`: random straight from cooldown-filtered pool (shuffle re-roll).
 * Cooldown is bypassed if it would leave nothing eligible.
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

  if (state.pickStrategy === "balanced") {
    let minUsage = Infinity;
    for (const c of pool) {
      const u = state.usageCount.get(c.id) ?? 0;
      if (u < minUsage) minUsage = u;
    }
    pool = pool.filter((c) => (state.usageCount.get(c.id) ?? 0) === minUsage);

    let minDur = Infinity;
    for (const c of pool) if (c.durationMs < minDur) minDur = c.durationMs;
    pool = pool.filter((c) => c.durationMs === minDur);
  }

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

export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  state?: MatchState,
  talkingHeadLayers: TalkingHeadLayer[] = [],
  disabledOverlayShots: Set<string> = new Set(),
): MatchedSection[] {
  const s = state ?? createMatchState();
  // Build the tag→layer lookup once per call so each section is O(1). Tags are
  // stored lowercase on TalkingHeadLayer (`talking-head-store` normalises on
  // write); section tags are lowercased at the lookup site below.
  const layerByTag = new Map<string, TalkingHeadLayer>();
  for (const l of talkingHeadLayers) layerByTag.set(l.tag, l);
  // The overlay layer is the single layer (if any) with kind === 'overlay'.
  // Cache it so the per-section loop is O(1) for overlay lookup.
  const overlayLayer = talkingHeadLayers.find((l) => l.kind === "overlay");

  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];
    // Section tags may include the synthetic overlay tag; the *base* tag is the
    // first non-overlay tag and drives base-clip resolution. The overlay tag is
    // handled separately below so it never collides with B-roll folder lookups.
    const baseTag = (section.tags.find((t) => t !== OVERLAY_TAG) ?? "").toLowerCase();
    const hasOverlay = section.tags.includes(OVERLAY_TAG);
    // Carry the absolute audio-timeline position through to MatchedSection so
    // downstream consumers (timeline, render pipeline) can place B-roll clips at
    // the script-specified timestamps instead of accumulating a cursor from 0.
    const startMs = section.startTime * 1000;
    const endMs = section.endTime * 1000;

    if (section.durationMs === 0) {
      return { sectionIndex, tag: baseTag, startMs, endMs, durationMs: 0, clips: [], warnings };
    }

    // Resolve the base layer clip[s] first, then attach the overlay (if any)
    // to the result. Base resolution mirrors the pre-overlay behaviour exactly.
    let clips: MatchedClip[];

    // TH layers win over any b-roll folder with a colliding name — a layer is an
    // explicit user assignment, while a folder match is implicit.
    const layer = layerByTag.get(baseTag);
    if (layer) {
      clips = [{
        clipId: "talking-head",
        fileId: layer.fileId,
        speedFactor: 1,
        trimDurationMs: section.durationMs,
        sourceSeekMs: startMs,
        isPlaceholder: false,
      }];
    } else {
      const candidates = clipsByBaseName.get(baseTag) ?? [];

      if (candidates.length === 0) {
        warnings.push(`No B-roll found for tag: ${baseTag}`);
        clips = [{ clipId: "placeholder", fileId: "", speedFactor: 1.0, isPlaceholder: true }];
      } else {
        // Trim-only: pick any clip with durationMs >= section.durationMs and trim from the start.
        // No speedup, no slowdown, no chaining — short clips are skipped to avoid distortion.
        const eligible = candidates.filter((c) => c.durationMs >= section.durationMs);
        if (eligible.length === 0) {
          warnings.push(`No B-roll long enough for tag: ${baseTag} (need ≥${section.durationMs}ms)`);
          clips = [{ clipId: "placeholder", fileId: "", speedFactor: 1, isPlaceholder: true }];
        } else {
          const clip = pickFromState(s, baseTag, eligible);
          clips = [{
            clipId: clip.id,
            fileId: clip.fileId,
            speedFactor: 1,
            trimDurationMs: section.durationMs,
            isPlaceholder: false,
          }];
        }
      }
    }

    // Resolve overlay: only when the section opted in, the user hasn't disabled
    // this shot, and the overlay layer is fully matted. Otherwise either silently
    // skip (user-disabled) or warn (not ready) — never block the base clip.
    let overlayClip: MatchedClip | undefined;
    if (hasOverlay) {
      const isDisabled = disabledOverlayShots.has(sectionKey({ startMs, endMs }));
      if (isDisabled) {
        // intentionally silent — user disabled this shot
      } else if (
        !overlayLayer ||
        overlayLayer.mattingStatus !== "ready" ||
        !overlayLayer.mattedFileId
      ) {
        warnings.push(
          `Overlay layer not ready — section ${sectionIndex + 1} rendered without overlay`,
        );
      } else {
        overlayClip = {
          clipId: "talking-head-overlay",
          fileId: overlayLayer.mattedFileId,
          speedFactor: 1,
          trimDurationMs: section.durationMs,
          sourceSeekMs: startMs,
          isPlaceholder: false,
          isOverlay: true,
        };
      }
    }

    return {
      sectionIndex,
      tag: baseTag,
      startMs,
      endMs,
      durationMs: section.durationMs,
      clips,
      ...(overlayClip ? { overlayClip } : {}),
      warnings,
    };
  });
}
