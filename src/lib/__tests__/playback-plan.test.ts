import { describe, it, expect } from "vitest";
import { buildSectionPlaybackPlan } from "../playback-plan";
import type { MatchedSection } from "../auto-match";

const seg = (
  durationMs: number,
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
  });
});
