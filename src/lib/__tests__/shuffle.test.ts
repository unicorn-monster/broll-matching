import { describe, it, expect } from "vitest";
import { shuffleTimeline } from "../shuffle";
import {
  buildClipsByBaseName,
  TALKING_HEAD_FILE_ID,
  type ClipMetadata,
  type MatchedSection,
} from "../auto-match";

const makeClip = (brollName: string, durationMs: number): ClipMetadata => ({
  id: brollName,
  brollName,
  baseName: brollName.replace(/-\d+$/, ""),
  durationMs,
  fileId: brollName,
  folderId: "f1",
  filename: `${brollName}.mp4`,
  width: 1080,
  height: 1350,
  fileSizeBytes: 1000,
  createdAt: new Date(),
});

const autoSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
  clipId: string,
  fileId: string,
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: [{ clipId, fileId, speedFactor: 1, trimDurationMs: durationMs, isPlaceholder: false }],
  warnings: [],
});

const lockedSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
  picks: { clipId: string; fileId: string }[],
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: picks.map((p) => ({ ...p, speedFactor: 1, isPlaceholder: false })),
  warnings: [],
  userLocked: true,
});

const thSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: [
    {
      clipId: "talking-head",
      fileId: TALKING_HEAD_FILE_ID,
      speedFactor: 1,
      trimDurationMs: durationMs,
      sourceSeekMs: startMs,
      isPlaceholder: false,
    },
  ],
  warnings: [],
});

const placeholderSection = (
  sectionIndex: number,
  tag: string,
  startMs: number,
  durationMs: number,
): MatchedSection => ({
  sectionIndex,
  tag,
  startMs,
  endMs: startMs + durationMs,
  durationMs,
  clips: [{ clipId: "placeholder", fileId: "", speedFactor: 1, isPlaceholder: true }],
  warnings: [],
});

const seededRng = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("shuffleTimeline", () => {
  it("preserves talking-head sections byte-for-byte", () => {
    const old = [thSection(0, "talking-head", 0, 1000), thSection(1, "talking-head", 1000, 1000)];
    const result = shuffleTimeline(old, new Map(), null, seededRng(1));
    expect(result.newTimeline).toEqual(old);
    expect(result.talkingHeadCount).toBe(2);
    expect(result.shuffledCount).toBe(0);
    expect(result.lockedKeptCount).toBe(0);
    expect(result.placeholderCount).toBe(0);
  });

  it("preserves userLocked sections", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000), makeClip("hook-03", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      lockedSection(0, "hook", 0, 2000, [{ clipId: "hook-01", fileId: "hook-01" }]),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[0]).toEqual(old[0]);
    expect(result.lockedKeptCount).toBe(1);
    expect(result.shuffledCount).toBe(0);
  });

  it("re-rolls auto sections through the matcher", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [autoSection(0, "hook", 0, 2000, "hook-01", "hook-01")];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.shuffledCount).toBe(1);
    expect(result.newTimeline[0]!.clips[0]!.isPlaceholder).toBe(false);
    expect(["hook-01", "hook-02"]).toContain(result.newTimeline[0]!.clips[0]!.clipId);
  });

  it("is deterministic for a fixed rng seed", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000), makeClip("hook-03", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      autoSection(0, "hook", 0, 2000, "hook-01", "hook-01"),
      autoSection(1, "hook", 2000, 2000, "hook-02", "hook-02"),
    ];
    const a = shuffleTimeline(old, idx, null, seededRng(42));
    const b = shuffleTimeline(old, idx, null, seededRng(42));
    expect(a.newTimeline).toEqual(b.newTimeline);
  });

  it("locked clips contribute to cooldown for adjacent auto sections", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      lockedSection(0, "hook", 0, 2000, [{ clipId: "hook-01", fileId: "hook-01" }]),
      autoSection(1, "hook", 2000, 2000, "hook-01", "hook-01"),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[1]!.clips[0]!.clipId).toBe("hook-02");
    expect(result.lockedKeptCount).toBe(1);
    expect(result.shuffledCount).toBe(1);
  });

  it("section with no candidate tag returns placeholder", () => {
    const idx = buildClipsByBaseName([]);
    const old = [autoSection(0, "unknown-tag", 0, 2000, "x", "x")];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[0]!.clips[0]!.isPlaceholder).toBe(true);
    expect(result.placeholderCount).toBe(1);
    expect(result.shuffledCount).toBe(0);
  });

  it("preserves sectionIndex from the old timeline", () => {
    const clips = [makeClip("hook-01", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      autoSection(7, "hook", 0, 2000, "hook-01", "hook-01"),
      autoSection(9, "hook", 2000, 2000, "hook-01", "hook-01"),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.newTimeline[0]!.sectionIndex).toBe(7);
    expect(result.newTimeline[1]!.sectionIndex).toBe(9);
  });

  it("mixed timeline counts each category correctly", () => {
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000)];
    const idx = buildClipsByBaseName(clips);
    const old = [
      thSection(0, "talking-head", 0, 1000),
      lockedSection(1, "hook", 1000, 2000, [{ clipId: "hook-01", fileId: "hook-01" }]),
      autoSection(2, "hook", 3000, 2000, "hook-01", "hook-01"),
      placeholderSection(3, "unknown", 5000, 2000),
    ];
    const result = shuffleTimeline(old, idx, null, seededRng(1));
    expect(result.talkingHeadCount).toBe(1);
    expect(result.lockedKeptCount).toBe(1);
    expect(result.shuffledCount).toBe(1);
    expect(result.placeholderCount).toBe(1);
  });

  it("uses varied picker — different seeds produce meaningfully different sequences", () => {
    // 5-clip pool, 5 auto sections of the same tag. Under the legacy "balanced" picker
    // every clip has unique duration → after shortest-fit filter the pool collapses to 1
    // → two seeds would produce the same A,B,C,D,E sequence. Under "varied" picker the
    // cooldown-filtered pool stays random and seeds diverge.
    const clips = [
      makeClip("hook-01", 5000),
      makeClip("hook-02", 5100),
      makeClip("hook-03", 5200),
      makeClip("hook-04", 5300),
      makeClip("hook-05", 5400),
    ];
    const idx = buildClipsByBaseName(clips);
    const old = [
      autoSection(0, "hook", 0, 2000, "hook-01", "hook-01"),
      autoSection(1, "hook", 2000, 2000, "hook-01", "hook-01"),
      autoSection(2, "hook", 4000, 2000, "hook-01", "hook-01"),
      autoSection(3, "hook", 6000, 2000, "hook-01", "hook-01"),
      autoSection(4, "hook", 8000, 2000, "hook-01", "hook-01"),
    ];
    const a = shuffleTimeline(old, idx, null, seededRng(1));
    const b = shuffleTimeline(old, idx, null, seededRng(99));
    const seqA = a.newTimeline.map((s) => s.clips[0]!.clipId).join(",");
    const seqB = b.newTimeline.map((s) => s.clips[0]!.clipId).join(",");
    expect(seqA).not.toBe(seqB);
  });
});
