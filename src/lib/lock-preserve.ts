import { matchSections, type MatchedSection, type ClipMetadata } from "./auto-match";
import type { ParsedSection } from "./script-parser";

/**
 * When a section is re-pasted with the same tag and a near-identical duration, we
 * carry the user's locked picks across by recomputing the chain's uniform speedFactor
 * for the new section length. Beyond ±20% the lock is dropped — the picks were chosen
 * for a different length and likely don't fit anymore.
 */
const DURATION_TOLERANCE = 0.2;

export interface LockPreserveResult {
  newTimeline: MatchedSection[];
  preservedCount: number;
  droppedCount: number;
}

/**
 * Diffs an old timeline against a freshly-parsed script. Locked sections from the old
 * timeline are consumed greedily left-to-right: each new section either inherits the
 * head of the lock queue (if tag + duration tolerance match) or is auto-matched fresh.
 * Unconsumed locks at the end count as dropped.
 *
 * Pure / deterministic apart from `matchSections`'s internal randomness for unlocked picks.
 */
export function preserveLocks(
  oldTimeline: MatchedSection[],
  newSections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
): LockPreserveResult {
  const lockQueue = oldTimeline.filter((s) => s.userLocked);
  const newTimeline: MatchedSection[] = [];
  let preservedCount = 0;

  for (const [i, ns] of newSections.entries()) {
    const head = lockQueue[0];
    const tagMatch = head ? head.tag.toLowerCase() === ns.tag.toLowerCase() : false;
    // Guard against zero-duration old sections — division would be NaN/Infinity.
    const durOk =
      head && head.durationMs > 0
        ? Math.abs(ns.durationMs - head.durationMs) / head.durationMs <= DURATION_TOLERANCE
        : false;

    if (head && tagMatch && durOk) {
      lockQueue.shift();
      // The chain's total real-clip ms is `oldDuration * oldSpeedFactor` (uniform speed).
      // To keep the chain ending exactly at the new duration, new speed = totalClipMs / newDuration.
      const realClips = head.clips.filter((c) => !c.isPlaceholder);
      const firstReal = realClips[0];
      const totalPickedMs = firstReal ? head.durationMs * firstReal.speedFactor : 0;
      const newSpeed =
        ns.durationMs > 0 && totalPickedMs > 0 ? totalPickedMs / ns.durationMs : 1;
      newTimeline.push({
        sectionIndex: i,
        tag: ns.tag,
        durationMs: ns.durationMs,
        clips: head.clips.map((c) => ({
          ...c,
          speedFactor: c.isPlaceholder ? 1 : newSpeed,
        })),
        warnings: [],
        userLocked: true,
      });
      preservedCount++;
    } else {
      // matchSections returns one entry per input section, so this is always defined.
      const matched = matchSections([ns], clipsByBaseName)[0];
      if (matched) {
        newTimeline.push({ ...matched, sectionIndex: i });
      }
    }
  }

  return {
    newTimeline,
    preservedCount,
    droppedCount: lockQueue.length,
  };
}
