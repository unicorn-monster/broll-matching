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

/**
 * Builds a playback plan that spans the entire timeline. Clips are emitted in
 * play order with absolute `startMs`/`endMs` measured from the start of the
 * master audio. Placeholders and clips with missing blob URLs are skipped, but
 * the time cursor still advances so subsequent clips stay aligned with the
 * audio (the player renders black during the gap).
 */
export function buildFullTimelinePlaybackPlan(
  timeline: MatchedSection[],
  audioUrl: string,
  clipBlobUrls: Map<string, string>,
): PlaybackPlan {
  const clips: PlaybackPlanClip[] = [];
  let cursor = 0;
  for (const section of timeline) {
    const real = section.clips.filter((c) => !c.isPlaceholder);
    if (real.length === 0) {
      cursor += section.durationMs;
      continue;
    }
    const slot = section.durationMs / real.length;
    for (const c of real) {
      const startMs = cursor;
      const endMs = cursor + slot;
      cursor = endMs;
      const url = clipBlobUrls.get(c.indexeddbKey);
      if (!url) continue;
      clips.push({ srcUrl: url, startMs, endMs, speedFactor: c.speedFactor });
    }
  }
  return { clips, audioUrl, audioStartMs: 0 };
}

/**
 * Returns the clip whose half-open time range [startMs, endMs) contains ms,
 * or null when ms falls in a gap (placeholder or missing-blob slot) or past
 * the last clip. Linear scan — clip count per timeline is small (< 50).
 */
export function findClipAtMs(clips: PlaybackPlanClip[], ms: number): PlaybackPlanClip | null {
  for (const c of clips) {
    if (ms >= c.startMs && ms < c.endMs) return c;
  }
  return null;
}

/**
 * Returns the section index whose cumulative duration window contains ms.
 * Used to keep `selectedSectionIndex` synchronized with the playhead so the
 * Inspector follows along during playback.
 */
export function findSectionAtMs(timeline: MatchedSection[], ms: number): number | null {
  let cursor = 0;
  for (let i = 0; i < timeline.length; i++) {
    const sectionMs = timeline[i]!.durationMs;
    if (ms >= cursor && ms < cursor + sectionMs) return i;
    cursor += sectionMs;
  }
  return null;
}
