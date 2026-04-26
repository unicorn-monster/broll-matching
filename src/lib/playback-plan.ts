import type { MatchedSection } from "./auto-match";

export interface PlaybackPlanClip {
  srcUrl: string;
  startMs: number;
  endMs: number;
  speedFactor: number;
}

export interface PlaybackPlan {
  clips: PlaybackPlanClip[];
  audioUrl: string;
  audioStartMs: number;
}

/**
 * Builds a per-section playback plan for the preview player. The plan tells the
 * player which clip blob URLs to render and where in the master audio track to
 * start playback so video and voice-over stay in lockstep.
 *
 * - `audioStartMs` is the cumulative duration of all preceding sections, which
 *   is where the master audio should seek to when this section starts.
 * - `clips` is one entry per non-placeholder MatchedClip with a resolved blob URL.
 *   Placeholder-only sections produce an empty array (player renders black).
 *   Clips whose blob hasn't been loaded yet are skipped defensively rather than
 *   blocking playback — caller can re-build the plan once loads finish. The
 *   skipped clip's slot still advances the time cursor so surviving clips stay
 *   aligned with the master audio (otherwise later clips would slide earlier).
 *
 * `startMs`/`endMs` slot the clips uniformly inside the section duration, which
 * matches how `matchSections` distributes a chain's playback time.
 */
export function buildSectionPlaybackPlan(
  timeline: MatchedSection[],
  sectionIndex: number,
  audioUrl: string,
  clipBlobUrls: Map<string, string>,
): PlaybackPlan {
  const audioStartMs = timeline
    .slice(0, sectionIndex)
    .reduce((sum, s) => sum + s.durationMs, 0);

  const section = timeline[sectionIndex];
  if (!section) return { clips: [], audioUrl, audioStartMs };

  const real = section.clips.filter((c) => !c.isPlaceholder);
  if (real.length === 0) return { clips: [], audioUrl, audioStartMs };

  const clips: PlaybackPlanClip[] = [];
  let cursor = 0;
  const slot = section.durationMs / real.length;
  for (const c of real) {
    const url = clipBlobUrls.get(c.indexeddbKey);
    const startMs = cursor;
    const endMs = cursor + slot;
    // Advance cursor unconditionally so a missing blob doesn't slide later
    // clips earlier and desync them from the master audio. The slot is
    // claimed even when nothing is emitted (player renders black for the gap).
    cursor = endMs;
    if (!url) continue;
    clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor });
  }

  return { clips, audioUrl, audioStartMs };
}
