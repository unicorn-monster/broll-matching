import { describe, it, expect } from "vitest";
import { buildClipsByBaseName, computeChainSpeed, matchSections, validateChain } from "../auto-match";
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
  it("Scenario A: section shorter than clip — speeds up", () => {
    const clips = [makeClip("hook-01", 8000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 4000)], map);
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0].speedFactor).toBeCloseTo(2.0, 1);
    expect(matched.clips[0].isPlaceholder).toBe(false);
  });

  it("Scenario A: speed > 2x — speeds up freely without trim", () => {
    const clips = [makeClip("hook-01", 20000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 4000)], map);
    expect(matched.clips[0].speedFactor).toBe(5.0);
    expect(matched.clips[0].trimDurationMs).toBeUndefined();
  });

  it("Scenario B: section longer than clip — chains", () => {
    const clips = [makeClip("hook-01", 3000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 7000)], map);
    expect(matched.clips.length).toBeGreaterThanOrEqual(2);
  });

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

  it("never slows down: all picked clips play at speedFactor >= 1.0", () => {
    // Bug reproduction: candidates[0] is long enough (>= section) so the old code
    // entered Scenario A, but pickRandom could select a SHORTER clip, producing speedFactor < 1.
    const clips = [
      makeClip("hook-01", 5000), // long — gates Scenario A
      makeClip("hook-02", 2000), // short — would cause slow-down if picked
    ];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 100; trial++) {
      const [matched] = matchSections([makeSection("Hook", 2833)], map);
      for (const clip of matched.clips) {
        expect(clip.speedFactor).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it("chains multiple clips uniformly sped up when no single clip fits", () => {
    // User example: section 4s, pool (2s, 3s) — no single clip ≥ 4s.
    // Expect chain of 2+ clips, uniform speedFactor ≥ 1.0 across all of them.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 20; trial++) {
      const [matched] = matchSections([makeSection("Hook", 4000)], map);
      expect(matched.clips.length).toBeGreaterThanOrEqual(2);
      const speeds = matched.clips.map((c) => c.speedFactor);
      // Uniform speed across chain
      expect(new Set(speeds.map((s) => s.toFixed(6))).size).toBe(1);
      // Never slow
      expect(speeds[0]).toBeGreaterThanOrEqual(1.0);
    }
  });

  it("single-clip case with only-shorter candidates still avoids slow-down", () => {
    // Single candidate, shorter than section. Must chain (repeat) rather than slow.
    const clips = [makeClip("hook-01", 2000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 2833)], map);
    expect(matched.clips.length).toBeGreaterThanOrEqual(2);
    for (const c of matched.clips) expect(c.speedFactor).toBeGreaterThanOrEqual(1.0);
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
