import { describe, it, expect } from "vitest";
import { buildSectionPlaybackPlan, buildFullTimelinePlaybackPlan, findClipAtMs, findSectionAtMs, clipIdentityKey } from "../playback-plan";
import type { MatchedSection } from "../auto-match";

// Layer-prefixed synthetic id matches `isLayerFileId` in shuffle. Plain string
// avoids dragging in the talking-head-types module purely for this constant.
const TH_LAYER_FILE_ID = "__th_layer__test";

const seg = (
  _durationMs: number,
  speedFactor: number,
  isPlaceholder = false,
  i = 0,
) => ({
  clipId: `c${i}`,
  fileId: `k${i}`,
  speedFactor,
  isPlaceholder,
});

function ms(start: number, end: number, clips: { key: string; speed: number; placeholder?: boolean }[]): MatchedSection {
  return {
    sectionIndex: 0,
    tag: "x",
    startMs: start,
    endMs: end,
    durationMs: end - start,
    userLocked: false,
    warnings: [],
    clips: clips.map((c) => ({
      clipId: `id-${c.key}`,
      fileId: c.key,
      speedFactor: c.speed,
      isPlaceholder: !!c.placeholder,
    })),
  };
}

describe("buildSectionPlaybackPlan", () => {
  it("uses section.startMs as audioStartMs (absolute, not cumulative)", () => {
    const timeline: MatchedSection[] = [
      { sectionIndex: 0, tag: "a", startMs: 0,    endMs: 5000,  durationMs: 5000, clips: [seg(5000, 1)], warnings: [] },
      { sectionIndex: 1, tag: "b", startMs: 8000, endMs: 11000, durationMs: 3000, clips: [seg(3000, 1, false, 1)], warnings: [] },
      { sectionIndex: 2, tag: "c", startMs: 20000, endMs: 24000, durationMs: 4000, clips: [seg(4000, 1, false, 2)], warnings: [] },
    ];
    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"], ["k2", "blob:2"]]);

    const plan = buildSectionPlaybackPlan(timeline, 1, "blob:audio", blobs);

    expect(plan.audioStartMs).toBe(8000);
    expect(plan.audioUrl).toBe("blob:audio");
  });

  it("emits one entry per non-placeholder clip with correct speedFactor", () => {
    const timeline: MatchedSection[] = [
      ms(0, 5000, [{ key: "k0", speed: 1.5 }, { key: "k1", speed: 1.5 }]),
    ];
    const blobs = new Map([["k0", "blob:0"], ["k1", "blob:1"]]);

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);

    expect(plan.clips).toHaveLength(2);
    expect(plan.clips[0]).toMatchObject({ srcUrl: "blob:0", speedFactor: 1.5 });
    expect(plan.clips[1]).toMatchObject({ srcUrl: "blob:1", speedFactor: 1.5 });
  });

  it("produces empty clips array when section is placeholder-only (renders black)", () => {
    const timeline: MatchedSection[] = [ms(0, 4000, [{ key: "k0", speed: 1, placeholder: true }])];
    const blobs = new Map();
    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toEqual([]);
  });

  it("skips clips whose blob URL is missing (defensive)", () => {
    const timeline: MatchedSection[] = [
      ms(0, 2000, [{ key: "k0", speed: 1 }, { key: "k1", speed: 1 }]),
    ];
    const blobs = new Map([["k0", "blob:0"]]); // k1 missing

    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", blobs);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.srcUrl).toBe("blob:0");
    expect(plan.clips[0]!.startMs).toBe(0);
    expect(plan.clips[0]!.endMs).toBe(1000);
  });
});

describe("buildFullTimelinePlaybackPlan", () => {
  it("returns empty clips when timeline is empty", () => {
    const plan = buildFullTimelinePlaybackPlan([], "audio.mp3", new Map());
    expect(plan.clips).toEqual([]);
    expect(plan.audioUrl).toBe("audio.mp3");
  });

  it("emits clips with absolute startMs based on section.startMs (gaps preserved)", () => {
    const timeline: MatchedSection[] = [
      ms(1000, 3000, [{ key: "a", speed: 1 }]),         // 1s..3s
      ms(10000, 13000, [                                  // 10s..13s, two clips → 1.5s each
        { key: "b", speed: 2 },
        { key: "c", speed: 1.5 },
      ]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"], ["c", "blob:c"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 1000,  endMs: 3000,  speedFactor: 1,   fileId: "a" },
      { srcUrl: "blob:b", startMs: 10000, endMs: 11500, speedFactor: 2,   fileId: "b" },
      { srcUrl: "blob:c", startMs: 11500, endMs: 13000, speedFactor: 1.5, fileId: "c" },
    ]);
  });

  it("skips placeholder-only sections — gap stays as gap (no clips emitted)", () => {
    const timeline: MatchedSection[] = [
      ms(0,    1000, [{ key: "a", speed: 1 }]),
      ms(1000, 3000, [{ key: "_", speed: 1, placeholder: true }]),
      ms(3000, 4000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0,    endMs: 1000, speedFactor: 1, fileId: "a" },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1, fileId: "b" },
    ]);
  });

  it("skips a real clip whose blob URL is missing", () => {
    const timeline: MatchedSection[] = [
      ms(0,    1000, [{ key: "a", speed: 1 }]),
      ms(1000, 3000, [{ key: "missing", speed: 1 }]),
      ms(3000, 4000, [{ key: "b", speed: 1 }]),
    ];
    const urls = new Map([["a", "blob:a"], ["b", "blob:b"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "audio.mp3", urls);
    expect(plan.clips).toEqual([
      { srcUrl: "blob:a", startMs: 0,    endMs: 1000, speedFactor: 1, fileId: "a" },
      { srcUrl: "blob:b", startMs: 3000, endMs: 4000, speedFactor: 1, fileId: "b" },
    ]);
  });
});

describe("findClipAtMs", () => {
  const clips = [
    { srcUrl: "blob:a", startMs: 0, endMs: 1000, speedFactor: 1, fileId: "a" },
    { srcUrl: "blob:b", startMs: 1000, endMs: 2500, speedFactor: 1.5, fileId: "b" },
    { srcUrl: "blob:c", startMs: 2500, endMs: 4000, speedFactor: 1, fileId: "c" },
  ];

  it("returns the clip whose half-open range [start, end) contains the ms", () => {
    expect(findClipAtMs(clips, 0)?.srcUrl).toBe("blob:a");
    expect(findClipAtMs(clips, 999)?.srcUrl).toBe("blob:a");
    expect(findClipAtMs(clips, 1000)?.srcUrl).toBe("blob:b");
    expect(findClipAtMs(clips, 2499)?.srcUrl).toBe("blob:b");
    expect(findClipAtMs(clips, 2500)?.srcUrl).toBe("blob:c");
  });

  it("returns null past the last clip's end", () => {
    expect(findClipAtMs(clips, 4000)).toBeNull();
    expect(findClipAtMs(clips, 9999)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(findClipAtMs([], 100)).toBeNull();
  });
});

describe("findSectionAtMs", () => {
  const timeline: MatchedSection[] = [
    ms(0,    1000, []),
    ms(3000, 5000, []),    // gap from 1000..3000
    ms(5000, 5500, []),
  ];

  it("maps an audio time to the section whose [startMs, endMs) contains it", () => {
    expect(findSectionAtMs(timeline, 0)).toBe(0);
    expect(findSectionAtMs(timeline, 999)).toBe(0);
    expect(findSectionAtMs(timeline, 3000)).toBe(1);
    expect(findSectionAtMs(timeline, 4999)).toBe(1);
    expect(findSectionAtMs(timeline, 5000)).toBe(2);
    expect(findSectionAtMs(timeline, 5499)).toBe(2);
  });

  it("returns null when ms falls in a gap between sections", () => {
    expect(findSectionAtMs(timeline, 1000)).toBeNull();
    expect(findSectionAtMs(timeline, 2999)).toBeNull();
  });

  it("returns null past the last section's end", () => {
    expect(findSectionAtMs(timeline, 5500)).toBeNull();
    expect(findSectionAtMs(timeline, 9999)).toBeNull();
  });

  it("returns null on empty timeline", () => {
    expect(findSectionAtMs([], 0)).toBeNull();
  });
});

describe("clipIdentityKey", () => {
  it("returns fileId:startMs", () => {
    const clip = { srcUrl: "blob:abc", startMs: 1500, endMs: 3000, speedFactor: 1, fileId: "k7" };
    expect(clipIdentityKey(clip)).toBe("k7:1500");
  });

  it("differentiates same blob at different startMs (same clip used twice)", () => {
    const a = { srcUrl: "blob:abc", startMs: 0, endMs: 1000, speedFactor: 1, fileId: "k1" };
    const b = { srcUrl: "blob:abc", startMs: 4000, endMs: 5000, speedFactor: 1, fileId: "k1" };
    expect(clipIdentityKey(a)).not.toBe(clipIdentityKey(b));
  });

  it("matches across plan rebuilds when key+startMs are equal", () => {
    const a = { srcUrl: "blob:1", startMs: 2000, endMs: 4000, speedFactor: 1, fileId: "k3" };
    const a2 = { srcUrl: "blob:2", startMs: 2000, endMs: 4000, speedFactor: 1.2, fileId: "k3" };
    expect(clipIdentityKey(a)).toBe(clipIdentityKey(a2));
  });
});

describe("playback-plan — sourceSeekMs propagation", () => {
  const timeline: MatchedSection[] = [{
    sectionIndex: 0,
    tag: "ugc-head",
    startMs: 5000,
    endMs: 6000,
    durationMs: 1000,
    clips: [{
      clipId: "talking-head",
      fileId: TH_LAYER_FILE_ID,
      speedFactor: 1,
      trimDurationMs: 1000,
      sourceSeekMs: 5000,
      isPlaceholder: false,
    }],
    warnings: [],
  }];

  it("buildSectionPlaybackPlan carries sourceSeekMs through", () => {
    const urls = new Map([[TH_LAYER_FILE_ID, "blob:fake"]]);
    const plan = buildSectionPlaybackPlan(timeline, 0, "blob:audio", urls);
    expect(plan.clips[0]!.sourceSeekMs).toBe(5000);
  });

  it("buildFullTimelinePlaybackPlan carries sourceSeekMs through", () => {
    const urls = new Map([[TH_LAYER_FILE_ID, "blob:fake"]]);
    const plan = buildFullTimelinePlaybackPlan(timeline, "blob:audio", urls);
    expect(plan.clips[0]!.sourceSeekMs).toBe(5000);
  });
});
