import { describe, it, expect } from "vitest";
import { buildClipsByBaseName, matchSections } from "../auto-match";
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

  it("Scenario A: speed > 2x — trims", () => {
    const clips = [makeClip("hook-01", 20000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 4000)], map);
    expect(matched.clips[0].speedFactor).toBe(2.0);
    expect(matched.clips[0].trimDurationMs).toBe(8000);
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
});
