import { describe, it, expect } from "vitest";
import { preserveLocks } from "../lock-preserve";
import type { MatchedSection, ClipMetadata } from "../auto-match";
import type { ParsedSection } from "../script-parser";

const makeClip = (id: string, brollName: string, durationMs: number): ClipMetadata => ({
  id,
  brollName,
  baseName: brollName.replace(/-\d+$/, ""),
  durationMs,
  fileId: id,
  folderId: "f1",
  filename: `${brollName}.mp4`,
  width: 1080,
  height: 1350,
  fileSizeBytes: 1000,
  createdAt: new Date(),
});

const makeMatched = (
  tag: string,
  durationMs: number,
  clipIds: string[],
  userLocked = false,
): MatchedSection => ({
  sectionIndex: 0,
  tag,
  durationMs,
  clips: clipIds.map((id) => ({
    clipId: id,
    fileId: id,
    speedFactor: 1,
    isPlaceholder: false,
  })),
  warnings: [],
  userLocked,
});

const makeParsed = (tag: string, durationMs: number, line = 1): ParsedSection => ({
  lineNumber: line,
  startTime: 0,
  endTime: durationMs / 1000,
  tag,
  scriptText: "",
  durationMs,
});

describe("preserveLocks", () => {
  it("preserves a locked section when tag and duration match exactly", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 5000)];
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.droppedCount).toBe(0);
    expect(result.newTimeline[0]!.userLocked).toBe(true);
    expect(result.newTimeline[0]!.clips[0]!.clipId).toBe("c1");
  });

  it("preserves locks within ±20% duration tolerance and recomputes speedFactor", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 5500)]; // +10%
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.newTimeline[0]!.clips[0]!.speedFactor).toBeCloseTo(5000 / 5500, 4);
    expect(result.newTimeline[0]!.durationMs).toBe(5500);
  });

  it("drops a lock when duration differs by more than 20%", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 7000)]; // +40%
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(0);
    expect(result.droppedCount).toBe(1);
    expect(result.newTimeline[0]!.userLocked).toBeFalsy();
  });

  it("drops a lock when tag changes", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("clipper", 5000)];
    const map = new Map([
      ["hook", [makeClip("c1", "hook-01", 5000)]],
      ["clipper", [makeClip("c2", "clipper-01", 5000)]],
    ]);

    const result = preserveLocks(old, newSections, map);

    expect(result.droppedCount).toBe(1);
    expect(result.newTimeline[0]!.tag).toBe("clipper");
    expect(result.newTimeline[0]!.userLocked).toBeFalsy();
    expect(result.newTimeline[0]!.clips[0]!.clipId).toBe("c2");
  });

  it("auto-matches new sections that have no locked counterpart", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const newSections = [makeParsed("hook", 5000), makeParsed("clipper", 4000)];
    const map = new Map([
      ["hook", [makeClip("c1", "hook-01", 5000)]],
      ["clipper", [makeClip("c2", "clipper-01", 4000)]],
    ]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.newTimeline).toHaveLength(2);
    expect(result.newTimeline[1]!.tag).toBe("clipper");
    expect(result.newTimeline[1]!.userLocked).toBeFalsy();
  });

  it("ignores unlocked sections in old timeline (always re-auto-matches)", () => {
    const old = [makeMatched("hook", 5000, ["c1"], false)];
    const newSections = [makeParsed("hook", 5000)];
    const map = new Map([["hook", [makeClip("c2", "hook-02", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(0);
    expect(result.droppedCount).toBe(0);
    expect(result.newTimeline[0]!.clips[0]!.clipId).toBe("c2");
  });

  it("matches greedily left-to-right, not by similarity", () => {
    // Two locked [hook] sections; new script reorders them. Greedy = first lock matches first new.
    const c1 = makeClip("c1", "hook-01", 5000);
    const c2 = makeClip("c2", "hook-02", 6000);
    const old = [
      makeMatched("hook", 5000, ["c1"], true),
      makeMatched("hook", 6000, ["c2"], true),
    ];
    const newSections = [makeParsed("hook", 6000), makeParsed("hook", 5000)];
    const map = new Map([["hook", [c1, c2]]]);

    const result = preserveLocks(old, newSections, map);

    // First new (6000ms) consumes first lock (5000ms): tolerance check |6000-5000|/5000 = 0.20
    // exactly = within, so consumed (boundary inclusive).
    expect(result.preservedCount).toBe(2);
    expect(result.newTimeline[0]!.clips[0]!.clipId).toBe("c1");
    expect(result.newTimeline[1]!.clips[0]!.clipId).toBe("c2");
  });

  it("counts unconsumed locks as dropped when new script has fewer sections", () => {
    const old = [
      makeMatched("hook", 5000, ["c1"], true),
      makeMatched("clipper", 4000, ["c2"], true),
    ];
    const newSections = [makeParsed("hook", 5000)];
    const map = new Map([["hook", [makeClip("c1", "hook-01", 5000)]]]);

    const result = preserveLocks(old, newSections, map);

    expect(result.preservedCount).toBe(1);
    expect(result.droppedCount).toBe(1);
    expect(result.newTimeline).toHaveLength(1);
  });

  it("returns empty timeline when newSections is empty", () => {
    const old = [makeMatched("hook", 5000, ["c1"], true)];
    const result = preserveLocks(old, [], new Map());
    expect(result.newTimeline).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });
});

describe("preserveLocks — neighbor avoidance with locks", () => {
  it("locked clip prevents adjacent unlocked auto-match from picking the same clip", () => {
    const c1 = makeClip("hook-01", "hook-01", 8000);
    const c2 = makeClip("hook-02", "hook-02", 8000);
    const map = new Map([["hook", [c1, c2]]]);
    const oldTimeline: MatchedSection[] = [
      makeMatched("hook", 3000, ["hook-01"], true),
    ];
    const newSections = [makeParsed("hook", 3000), makeParsed("hook", 3000)];
    for (let trial = 0; trial < 200; trial++) {
      const { newTimeline } = preserveLocks(oldTimeline, newSections, map);
      expect(newTimeline[0]!.clips[0]!.clipId).toBe("hook-01");
      expect(newTimeline[1]!.clips[0]!.clipId).toBe("hook-02");
    }
  });

  it("when no locks match, auto-match across sections still avoids back-to-back", () => {
    const c1 = makeClip("hook-01", "hook-01", 8000);
    const c2 = makeClip("hook-02", "hook-02", 8000);
    const c3 = makeClip("hook-03", "hook-03", 8000);
    const map = new Map([["hook", [c1, c2, c3]]]);
    const newSections = Array.from({ length: 4 }, () => makeParsed("hook", 3000));
    for (let trial = 0; trial < 100; trial++) {
      const { newTimeline } = preserveLocks([], newSections, map);
      for (let i = 1; i < newTimeline.length; i++) {
        expect(newTimeline[i]!.clips[0]!.clipId).not.toBe(newTimeline[i - 1]!.clips[0]!.clipId);
      }
    }
  });
});
