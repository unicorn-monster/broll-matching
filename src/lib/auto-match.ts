import type { ParsedSection } from "@/lib/script-parser";

// Sentinel clip ID used when a tag has no clips — renderer generates black frames
export const PLACEHOLDER_CLIP_ID = "__placeholder__";

export interface ClipMetadata {
  id: string;
  durationMs: number;
}

export interface MatchInput {
  sections: ParsedSection[];
  /** Tag name (any casing) → available clips for that tag */
  clipsByTag: Map<string, ClipMetadata[]>;
}

export interface MatchedClip {
  clipId: string;
  /** 1.0 = normal speed. Values > 1.0 = sped up (max 2.0). */
  speedFactor: number;
  /** If set, clip is trimmed to this many ms before the speed-up is applied. */
  trimDurationMs?: number;
  /** true = no real clip; renderer should produce black frames for the section duration */
  isPlaceholder: boolean;
}

export interface MatchedSection {
  sectionIndex: number;
  clips: MatchedClip[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Match all sections in one pass. */
export function matchSections(input: MatchInput): MatchedSection[] {
  return input.sections.map((section, index) =>
    matchOneSection(section, index, input.clipsByTag)
  );
}

/**
 * Re-roll the clip selection for a single section.
 * Pass the clip IDs currently assigned so the engine can try different ones.
 */
export function rerollSection(
  section: ParsedSection,
  sectionIndex: number,
  clipsByTag: Map<string, ClipMetadata[]>,
  currentClipIds: string[] = []
): MatchedSection {
  const available = findClipsForTag(section.tag, clipsByTag);
  if (!available || available.length === 0) {
    return matchOneSection(section, sectionIndex, clipsByTag);
  }
  // Re-roll: exclude current assignment so we get fresh clips if possible
  const exclude = new Set(currentClipIds);
  return buildMatchedSection(section, sectionIndex, available, exclude);
}

/**
 * Manual swap: force a specific clip for a section.
 * Engine calculates the right speed/trim to fill the section duration.
 * If the clip is shorter than the section, it is looped.
 */
export function swapClip(
  section: ParsedSection,
  sectionIndex: number,
  clip: ClipMetadata
): MatchedSection {
  if (section.durationMs === 0) {
    return { sectionIndex, clips: [], warnings: [] };
  }
  const { clips, warnings } = fillDuration(section.durationMs, [clip], new Set());
  return { sectionIndex, clips, warnings };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function matchOneSection(
  section: ParsedSection,
  sectionIndex: number,
  clipsByTag: Map<string, ClipMetadata[]>
): MatchedSection {
  // Zero-duration: skip
  if (section.durationMs === 0) {
    return { sectionIndex, clips: [], warnings: [] };
  }

  const available = findClipsForTag(section.tag, clipsByTag);

  // Empty tag folder: black placeholder
  if (!available || available.length === 0) {
    return {
      sectionIndex,
      clips: [{ clipId: PLACEHOLDER_CLIP_ID, speedFactor: 1.0, isPlaceholder: true }],
      warnings: [`No clips for tag "${section.tag}" — black placeholder will be used`],
    };
  }

  return buildMatchedSection(section, sectionIndex, available, new Set());
}

function buildMatchedSection(
  section: ParsedSection,
  sectionIndex: number,
  available: ClipMetadata[],
  excludeIds: Set<string>
): MatchedSection {
  const { clips, warnings } = fillDuration(section.durationMs, available, excludeIds);
  return { sectionIndex, clips, warnings };
}

/**
 * Fill `totalMs` of playback using clips from `available`.
 *
 * Strategy:
 * - Pick clips one at a time (avoiding repeats when possible).
 * - If clip.durationMs <= remainingMs → use at 1× speed, subtract from remaining.
 * - If clip.durationMs > remainingMs → Scenario A (speed up or trim+2×).
 */
function fillDuration(
  totalMs: number,
  available: ClipMetadata[],
  excludeIds: Set<string>
): { clips: MatchedClip[]; warnings: string[] } {
  const result: MatchedClip[] = [];
  const warnings: string[] = [];
  let remainingMs = totalMs;
  const usedThisSection = new Set<string>(excludeIds);

  while (remainingMs > 0) {
    const clip = pickClip(available, usedThisSection);

    // Only track used IDs when there are multiple clips to choose from
    if (available.length > 1) {
      usedThisSection.add(clip.id);
    }

    if (clip.durationMs <= remainingMs) {
      // Scenario B path: clip fits entirely
      result.push({ clipId: clip.id, speedFactor: 1.0, isPlaceholder: false });
      remainingMs -= clip.durationMs;
    } else {
      // Scenario A path: clip is longer than remaining time
      result.push(scenarioA(clip, remainingMs));
      remainingMs = 0;
    }
  }

  return { clips: result, warnings };
}

/**
 * Scenario A: clip is longer than the section (or remaining) duration.
 *
 * - speedFactor = clip.durationMs / sectionMs
 * - If speedFactor <= 2.0 → use clip at that speed
 * - If speedFactor > 2.0  → trim clip to sectionMs * 2, then play at 2×
 */
function scenarioA(clip: ClipMetadata, sectionMs: number): MatchedClip {
  const speedFactor = clip.durationMs / sectionMs;

  if (speedFactor <= 2.0) {
    return { clipId: clip.id, speedFactor, isPlaceholder: false };
  }

  // Need to trim first, then play at max 2×
  const trimDurationMs = sectionMs * 2;
  return { clipId: clip.id, speedFactor: 2.0, trimDurationMs, isPlaceholder: false };
}

/**
 * Pick a random clip, preferring clips not already used in this section.
 * Falls back to any clip if all have been used (single-clip or exhausted pool).
 */
function pickClip(clips: ClipMetadata[], exclude: Set<string>): ClipMetadata {
  const fresh = clips.filter((c) => !exclude.has(c.id));
  const pool = fresh.length > 0 ? fresh : clips;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Case-insensitive lookup of clips for a given tag name. */
function findClipsForTag(
  tag: string,
  clipsByTag: Map<string, ClipMetadata[]>
): ClipMetadata[] | undefined {
  const needle = tag.toLowerCase();
  for (const [key, clips] of clipsByTag) {
    if (key.toLowerCase() === needle) return clips;
  }
  return undefined;
}
