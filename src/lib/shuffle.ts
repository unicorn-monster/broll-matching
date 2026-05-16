import {
  createMatchState,
  markUsed,
  matchSections,
  type ClipMetadata,
  type MatchedSection,
} from "./auto-match";
import type { ParsedSection } from "./script-parser";
import { isLayerFileId, type TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

export interface ShuffleResult {
  newTimeline: MatchedSection[];
  /** Auto sections that ran through matchSections and produced a real (non-placeholder) pick. */
  shuffledCount: number;
  /** Sections preserved because userLocked === true. */
  lockedKeptCount: number;
  /** Sections preserved because they are talking-head slices. */
  talkingHeadCount: number;
  /** Auto sections that re-rolled to a placeholder (no candidate clip). */
  placeholderCount: number;
}

/**
 * Detects a talking-head section by the per-layer synthetic fileId prefix
 * (`__th_layer__`). Multi-layer aware — any layer-derived clip triggers the
 * preserve branch, never the re-roll branch.
 */
function isTalkingHeadSection(section: MatchedSection): boolean {
  return section.clips.some((c) => isLayerFileId(c.fileId));
}

/**
 * Re-rolls all auto-matched B-roll sections while preserving:
 *  - userLocked sections (clips + speedFactor untouched)
 *  - talking-head sections (deterministic by tag, never re-rolled)
 *
 * Locked sections' real clips are fed into MatchState via markUsed before
 * subsequent auto-section matching so adjacency cooldown carries correctly.
 *
 * Pure apart from the supplied `rng` (defaults to Math.random).
 */
export function shuffleTimeline(
  oldTimeline: MatchedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  talkingHeadLayers: TalkingHeadLayer[] = [],
  rng: () => number = Math.random,
): ShuffleResult {
  const state = createMatchState(rng, "varied");
  const newTimeline: MatchedSection[] = [];
  let shuffledCount = 0;
  let lockedKeptCount = 0;
  let talkingHeadCount = 0;
  let placeholderCount = 0;

  for (const section of oldTimeline) {
    if (isTalkingHeadSection(section)) {
      newTimeline.push(section);
      talkingHeadCount++;
      continue;
    }

    if (section.userLocked) {
      newTimeline.push(section);
      const tagKey = section.tag.toLowerCase();
      for (const c of section.clips) {
        if (!c.isPlaceholder) markUsed(state, tagKey, c.clipId);
      }
      lockedKeptCount++;
      continue;
    }

    const ps: ParsedSection = {
      lineNumber: 0,
      scriptText: "",
      tag: section.tag,
      startTime: section.startMs / 1000,
      endTime: section.endMs / 1000,
      durationMs: section.durationMs,
    };
    const matched = matchSections([ps], clipsByBaseName, state, talkingHeadLayers)[0]!;
    matched.sectionIndex = section.sectionIndex;
    newTimeline.push(matched);

    const allPlaceholder = matched.clips.every((c) => c.isPlaceholder);
    if (allPlaceholder) placeholderCount++;
    else shuffledCount++;
  }

  return { newTimeline, shuffledCount, lockedKeptCount, talkingHeadCount, placeholderCount };
}
