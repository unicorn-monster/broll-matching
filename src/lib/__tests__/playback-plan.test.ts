import { describe, it, expect } from "vitest";
import { buildSectionPlaybackPlan, buildFullTimelinePlaybackPlan } from "../playback-plan";
import type { MatchedSection } from "../auto-match";

// First arg (clip duration) is informational only — MatchedClip carries
// speedFactor + indexeddbKey, not its own duration. Keeps call sites readable.
const seg = (
  _durationMs: number,
  speedFactor: number,
  isPlaceholder = false,
  i = 0,
) => ({
  clipId: `c${i}`,
  indexeddbKey: `k${i}`,
  speedFactor,
  isPlaceholder,
});

describe("buildSectionPlaybackPlan", () => {
  it("computes audioStartMs as the cumulative duration of preceding sections", () => {
    const timeline = [
      { sectionIndex: 0, tag: "a", durationMs: 5000, clips: [seg(5000, 1)], warnings: [] },
      { sectionIndex: 1, tag: "b", durationMs: 3000, clips: [seg(3000, 1)], warnings: [] },
      { sectionIndex: 2, tag: "c", durationMs: 4000, clips: [seg(4000, 1)], warnings: [] },
    ] as MatchedSection[];

    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"], ["k2", "blob:2"]]);

    const plan = buildSectionPlaybackPlan(timeline, 1, "blob:audio", blobs);

    expect(plan.audioStartMs).toBe(5000);
    expect(plan.audioUrl).toBe("blob:audio");
  });

  it("emits one entry per non-placeholder clip with the correct speedFactor", () => {
    const timeline = [
      {
        sectionIndex: 0,
        tag: "a",
        durationMs: 5000,
        clips: [seg(2500, 1.5, false, 0), seg(2500, 1.5, false, 1)],
        warnings: [],
      },
    ] as MatchedSection[];
    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"]]);

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);

    expect(plan.clips).toHaveLength(2);
    expect(plan.clips[0]).toMatchObject({ srcUrl: "blob:0", speedFactor: 1.5 });
    expect(plan.clips[1]).toMatchObject({ srcUrl: "blob:1", speedFactor: 1.5 });
  });

  it("produces an empty clips array when section is placeholder-only (renders black)", () => {
    const timeline = [
      { sectionIndex: 0, tag: "?", durationMs: 4000, clips: [seg(0, 1, true)], warnings: [] },
    ] as MatchedSection[];
    const blobs = new Map();
    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toEqual([]);
  });

  it("skips clips whose blob URL is missing (defensive — clip not loaded yet)", () => {
    const timeline = [
      {
        sectionIndex: 0,
        tag: "a",
        durationMs: 2000,
        clips: [seg(1000, 1, false, 0), seg(1000, 1, false, 1)],
        warnings: [],
      },
    ] as MatchedSection[];
    const blobs = new Map([["k0", "blob:0"]]); // k1 missing

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.srcUrl).toBe("blob:0");
    expect(plan.clips[0]!.startMs).toBe(0);
    expect(plan.clips[0]!.endMs).toBe(1000);
  });
});

function s(durationMs: number, clips: { key: string; speed: number; placeholder?: boolean }[]): MatchedSection {
  return {
    sectionIndex: 0,
    tag: "x",
    durationMs,
    userLocked: false,
    warnings: [],
    clips: clips.map((c) => ({
      clipId: `id-${c.key}`,
      indexeddbKey: c.key,
      speedFactor: c.speed,
      isPlaceholder: !!c.placeholder,
    })),
  };
}

describe("buildFullTimelinePlaybackPlan", () => {
  it("returns empty clips when timeline is empty", () => {
    const plan = buildFullTimelinePlaybackPlan([], "audio.mp3", new Map());
    expect(plan.clips).toEqual([]);
    expect(plan.audioUrl).toBe("audio.mp3");
  });

  it("emits one clip per real chain entry with absolute start/end across sections", () => {
    const timeline = [
      s(2000, [{ key: "a", speed: 1 }]),
      s(3000, [{ key: "b", speed: 2 }, { key: "c", speed: 1.5 }]),
    ];
    const urls = new Map([
      ["a", "blob:a"],
      ["b", "blob:b"],
      ["c", "blob:c"],
    ]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0, endMs: 2000, speedFactor: 1 },
      { srcUrl: "blob:b", startMs: 2000, endMs: 3500, speedFactor: 2 },
      { srcUrl: "blob:c", startMs: 3500, endMs: 5000, speedFactor: 1.5 },
    ]);
  });

  it("skips placeholder-only sections but advances the cursor", () => {
    const timeline = [
      s(1000, [{ key: "a", speed: 1 }]),
      s(2000, [{ key: "_", speed: 1, placeholder: true }]),
      s(1000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1 },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1 },
    ]);
  });

  it("skips a real clip whose blob URL is missing but keeps later clips aligned", () => {
    const timeline = [
      s(1000, [{ key: "a", speed: 1 }]),
      s(2000, [{ key: "missing", speed: 1 }]),
      s(1000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1 },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1 },
    ]);
  });
});
