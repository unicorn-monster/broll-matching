import { describe, it, expect } from "vitest";
import {
  buildClipsByBaseName,
  buildManualChain,
  computeChainSpeed,
  matchSections,
  validateChain,
} from "../auto-match";
import type { ClipMetadata } from "../auto-match";
import type { ParsedSection } from "../script-parser";

const makeClip = (brollName: string, durationMs: number) => ({
  id: brollName,
  brollName,
  baseName: brollName.replace(/-\d+$/, ""),
  durationMs,
  indexeddbKey: brollName,
  folderId: "f1",
  productId: "p1",
  filename: `${brollName}.mp4`,
  width: 1080,
  height: 1350,
  fileSizeBytes: 1000,
  createdAt: new Date(),
});

const makeSection = (tag: string, durationMs: number): ParsedSection => ({
  lineNumber: 1,
  startTime: 0,
  endTime: durationMs / 1000,
  tag,
  scriptText: "text",
  durationMs,
});

describe("buildClipsByBaseName", () => {
  it("groups variants by base name", () => {
    const clips = [
      makeClip("hook-01", 5000),
      makeClip("hook-02", 6000),
      makeClip("outro-01", 4000),
    ];
    const map = buildClipsByBaseName(clips);
    expect(map.get("hook")).toHaveLength(2);
    expect(map.get("outro")).toHaveLength(1);
  });
});

describe("matchSections", () => {
  it("no matching base name — placeholder", () => {
    const [matched] = matchSections([makeSection("unknown-tag", 4000)], new Map());
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0].isPlaceholder).toBe(true);
    expect(matched.warnings.some((w) => w.includes("No B-roll"))).toBe(true);
  });

  it("zero-duration section — empty clips", () => {
    const clips = [makeClip("hook-01", 5000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 0)], map);
    expect(matched.clips).toHaveLength(0);
  });

  it("Case 1 speedup-ok: clip <= 1.3x section — picks from speedup-ok subset", () => {
    // Section 1s, candidates: 1.2s (ratio 1.2 ✓), 5s (ratio 5 ✗), 3s (ratio 3 ✗)
    const clips = [makeClip("hook-01", 1200), makeClip("hook-02", 5000), makeClip("hook-03", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 50; trial++) {
      const [matched] = matchSections([makeSection("Hook", 1000)], map);
      expect(matched.clips).toHaveLength(1);
      const c = matched.clips[0]!;
      // Only the 1.2s clip is speedup-ok
      expect(c.clipId).toBe("hook-01");
      expect(c.speedFactor).toBeCloseTo(1.2, 4);
      expect(c.trimDurationMs).toBeUndefined();
      expect(c.isPlaceholder).toBe(false);
    }
  });

  it("Case 1 boundary: clip exactly 1.3x section — speedup mode (inclusive)", () => {
    // Section 1s, clip 1.3s. Ratio = 1.3 exactly, qualifies as speedup-ok.
    const clips = [makeClip("hook-01", 1300)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 1000)], map);
    expect(matched.clips).toHaveLength(1);
    const c = matched.clips[0]!;
    expect(c.speedFactor).toBeCloseTo(1.3, 4);
    expect(c.trimDurationMs).toBeUndefined();
  });

  it("Case 1 trim fallback: all longEnough > 1.3x section — trim mode", () => {
    // Section 1s, candidates all > 1.3s: 2s, 2.4s, 3s.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 2400), makeClip("hook-03", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 50; trial++) {
      const [matched] = matchSections([makeSection("Hook", 1000)], map);
      expect(matched.clips).toHaveLength(1);
      const c = matched.clips[0]!;
      expect(c.speedFactor).toBe(1);
      expect(c.trimDurationMs).toBe(1000);
      expect(c.isPlaceholder).toBe(false);
      // The picked clip is one of the longEnough candidates.
      expect(["hook-01", "hook-02", "hook-03"]).toContain(c.clipId);
    }
  });

  it("Case 1 mixed: only picks from speedup-ok subset, never from trim-only candidates", () => {
    // Section 1s. 1.2s is speedup-ok; 5s would be trim-only. Pick must always be 1.2s.
    const clips = [makeClip("hook-01", 1200), makeClip("hook-02", 5000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 100; trial++) {
      const [matched] = matchSections([makeSection("Hook", 1000)], map);
      expect(matched.clips[0]!.clipId).toBe("hook-01");
      expect(matched.clips[0]!.trimDurationMs).toBeUndefined();
    }
  });

  it("Case 2 speedup pair: total > section — both clips share speedFactor > 1", () => {
    // Section 4s, candidates 2s + 3s → total 5s, ratio 1.25.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 30; trial++) {
      const [matched] = matchSections([makeSection("Hook", 4000)], map);
      expect(matched.clips).toHaveLength(2);
      const [a, b] = matched.clips;
      expect(a!.speedFactor).toBeCloseTo(1.25, 4);
      expect(b!.speedFactor).toBeCloseTo(1.25, 4);
      expect(a!.trimDurationMs).toBeUndefined();
      expect(b!.trimDurationMs).toBeUndefined();
      // distinct clip IDs
      expect(a!.clipId).not.toBe(b!.clipId);
    }
  });

  it("Case 2 slowdown pair: total < section — speedFactor < 1, no floor", () => {
    // Section 5s, candidates 2s + 2.4s → total 4.4s, ratio 0.88.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 2400)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 5000)], map);
    expect(matched.clips).toHaveLength(2);
    expect(matched.clips[0]!.speedFactor).toBeCloseTo(0.88, 4);
    expect(matched.clips[1]!.speedFactor).toBeCloseTo(0.88, 4);
  });

  it("Case 2 exact fit: total == section — speedFactor === 1", () => {
    // Section 5s, candidates 2s + 3s → total 5s, ratio 1.0 exactly.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 5000)], map);
    expect(matched.clips).toHaveLength(2);
    expect(matched.clips[0]!.speedFactor).toBe(1);
    expect(matched.clips[1]!.speedFactor).toBe(1);
  });

  it("Case 2 distinct picks: 3+ variants — pair is always two different clips", () => {
    const clips = [
      makeClip("hook-01", 1500),
      makeClip("hook-02", 1700),
      makeClip("hook-03", 1900),
    ];
    const map = buildClipsByBaseName(clips);
    const seenPairs = new Set<string>();
    for (let trial = 0; trial < 200; trial++) {
      const [matched] = matchSections([makeSection("Hook", 5000)], map);
      expect(matched.clips).toHaveLength(2);
      const [a, b] = matched.clips;
      expect(a!.clipId).not.toBe(b!.clipId);
      seenPairs.add([a!.clipId, b!.clipId].sort().join("+"));
    }
    // Sanity: with 3 variants there are 3 unordered pairs; a healthy random
    // sampler should produce more than one in 200 trials.
    expect(seenPairs.size).toBeGreaterThan(1);
  });

  it("Case 2 placeholder when fewer than 2 variants exist", () => {
    // Single short variant: longEnough is empty, candidates.length === 1 → placeholder.
    const clips = [makeClip("hook-01", 2000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 5000)], map);
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0]!.isPlaceholder).toBe(true);
    expect(matched.clips[0]!.clipId).toBe("placeholder");
    expect(matched.warnings.some((w) => w.includes("Need ≥2 variants"))).toBe(true);
    expect(matched.warnings.some((w) => w.toLowerCase().includes("hook"))).toBe(true);
  });
});

describe("computeChainSpeed", () => {
  it("returns 1.0 for an exact-match single clip", () => {
    expect(computeChainSpeed([5000], 5000)).toBe(1);
  });

  it("returns clip/section ratio for single clip longer than section", () => {
    expect(computeChainSpeed([8000], 4000)).toBe(2);
  });

  it("returns slow-down ratio (<1) for single clip shorter than section", () => {
    expect(computeChainSpeed([3000], 5000)).toBeCloseTo(0.6, 2);
  });

  it("returns total/section ratio for multi-clip chain", () => {
    expect(computeChainSpeed([2500, 3400], 5000)).toBeCloseTo(1.18, 2);
  });

  it("returns 0 for empty chain", () => {
    expect(computeChainSpeed([], 5000)).toBe(0);
  });
});

describe("validateChain", () => {
  it("returns null when speed exactly at MIN_SPEED_FACTOR (0.8)", () => {
    expect(validateChain([4000], 5000)).toBeNull();
  });

  it("returns TOO_SLOW error when speed below 0.8", () => {
    const result = validateChain([3500], 5000); // 0.7×
    expect(result).not.toBeNull();
    expect(result!.code).toBe("TOO_SLOW");
    expect(result!.message).toMatch(/too short/i);
  });

  it("returns null for chain at exactly section duration (1.0×)", () => {
    expect(validateChain([5000], 5000)).toBeNull();
  });

  it("returns null for high speed-up (no upper cap)", () => {
    expect(validateChain([20000], 5000)).toBeNull(); // 4×
  });

  it("returns EMPTY error for empty chain", () => {
    const result = validateChain([], 5000);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("EMPTY");
  });
});

describe("buildManualChain", () => {
  const clipA = { id: "a", indexeddbKey: "a-key", durationMs: 2500 } as ClipMetadata;
  const clipB = { id: "b", indexeddbKey: "b-key", durationMs: 3400 } as ClipMetadata;

  it("produces uniform speedFactor across all picks", () => {
    const chain = buildManualChain([clipA, clipB], 5000);
    expect(chain).toHaveLength(2);
    const expected = (2500 + 3400) / 5000;
    expect(chain[0]!.speedFactor).toBeCloseTo(expected, 4);
    expect(chain[1]!.speedFactor).toBeCloseTo(expected, 4);
  });

  it("preserves clipId and indexeddbKey for each pick in order", () => {
    const chain = buildManualChain([clipA, clipB], 5000);
    expect(chain[0]!.clipId).toBe("a");
    expect(chain[0]!.indexeddbKey).toBe("a-key");
    expect(chain[1]!.clipId).toBe("b");
    expect(chain[1]!.indexeddbKey).toBe("b-key");
  });

  it("sets isPlaceholder false for all picks", () => {
    const chain = buildManualChain([clipA], 2500);
    expect(chain[0]!.isPlaceholder).toBe(false);
  });

  it("returns single placeholder when picks is empty", () => {
    const chain = buildManualChain([], 5000);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.isPlaceholder).toBe(true);
    expect(chain[0]!.clipId).toBe("placeholder");
    expect(chain[0]!.indexeddbKey).toBe("");
    expect(chain[0]!.speedFactor).toBe(1);
  });
});
