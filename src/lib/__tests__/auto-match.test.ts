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
  fileId: brollName,
  folderId: "f1",
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
    const matched = matchSections([makeSection("unknown-tag", 4000)], new Map())[0]!;
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0]!.isPlaceholder).toBe(true);
    expect(matched.warnings.some((w) => w.includes("No B-roll"))).toBe(true);
  });

  it("zero-duration section — empty clips", () => {
    const clips = [makeClip("hook-01", 5000)];
    const map = buildClipsByBaseName(clips);
    const matched = matchSections([makeSection("Hook", 0)], map)[0]!;
    expect(matched.clips).toHaveLength(0);
  });

  it("trim mode: clip exactly equal to section — trim with speedFactor 1", () => {
    // Section 1s, clip 1s. Eligible (>= 1s), trimmed to 1s.
    const clips = [makeClip("hook-01", 1000)];
    const map = buildClipsByBaseName(clips);
    const matched = matchSections([makeSection("Hook", 1000)], map)[0]!;
    expect(matched.clips).toHaveLength(1);
    const c = matched.clips[0]!;
    expect(c.clipId).toBe("hook-01");
    expect(c.speedFactor).toBe(1);
    expect(c.trimDurationMs).toBe(1000);
    expect(c.isPlaceholder).toBe(false);
  });

  it("trim mode: clip longer than section — trim from start, speedFactor 1", () => {
    // Section 3s, clip 4s. Trim to 3s.
    const clips = [makeClip("hook-01", 4000)];
    const map = buildClipsByBaseName(clips);
    const matched = matchSections([makeSection("Hook", 3000)], map)[0]!;
    expect(matched.clips).toHaveLength(1);
    const c = matched.clips[0]!;
    expect(c.speedFactor).toBe(1);
    expect(c.trimDurationMs).toBe(3000);
  });

  it("trim mode: only picks from clips long enough, ignores shorter ones", () => {
    // Section 3s. 2s clip ineligible, 4s and 5s eligible.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 4000), makeClip("hook-03", 5000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 100; trial++) {
      const matched = matchSections([makeSection("Hook", 3000)], map)[0]!;
      expect(matched.clips).toHaveLength(1);
      const c = matched.clips[0]!;
      expect(c.clipId).not.toBe("hook-01");
      expect(["hook-02", "hook-03"]).toContain(c.clipId);
      expect(c.speedFactor).toBe(1);
      expect(c.trimDurationMs).toBe(3000);
      expect(c.isPlaceholder).toBe(false);
    }
  });

  it("trim mode: shortest-fit — first pick prefers the clip closest to section duration", () => {
    // Section 3s, eligible 4s/5s/6s. Shortest-fit deterministically picks the 4s clip first.
    const clips = [makeClip("hook-01", 4000), makeClip("hook-02", 5000), makeClip("hook-03", 6000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 50; trial++) {
      const matched = matchSections([makeSection("Hook", 3000)], map)[0]!;
      expect(matched.clips[0]!.clipId).toBe("hook-01");
    }
  });

  it("trim mode: ties on duration broken randomly across all eligible clips", () => {
    // All clips equal duration → least-used + shortest-fit tie → rng picks among them.
    const clips = [makeClip("hook-01", 5000), makeClip("hook-02", 5000), makeClip("hook-03", 5000)];
    const map = buildClipsByBaseName(clips);
    const seen = new Set<string>();
    for (let trial = 0; trial < 200; trial++) {
      const matched = matchSections([makeSection("Hook", 3000)], map)[0]!;
      seen.add(matched.clips[0]!.clipId);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("placeholder when no clip is long enough", () => {
    // Section 5s, all candidates shorter (2s, 3s) — no eligible clip → placeholder.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    const matched = matchSections([makeSection("Hook", 5000)], map)[0]!;
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0]!.isPlaceholder).toBe(true);
    expect(matched.clips[0]!.clipId).toBe("placeholder");
    expect(matched.warnings.some((w) => w.toLowerCase().includes("no b-roll long enough"))).toBe(true);
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

describe("matchSections — no back-to-back repeats", () => {
  it("never picks the same clip for adjacent same-tag sections (pool >= 2)", () => {
    const clips = [
      makeClip("hook-01", 8000),
      makeClip("hook-02", 8000),
      makeClip("hook-03", 8000),
      makeClip("hook-04", 8000),
      makeClip("hook-05", 8000),
    ];
    const map = buildClipsByBaseName(clips);
    const sections = Array.from({ length: 4 }, () => makeSection("Hook", 3000));
    for (let trial = 0; trial < 200; trial++) {
      const matched = matchSections(sections, map);
      for (let i = 1; i < matched.length; i++) {
        expect(matched[i]!.clips[0]!.clipId).not.toBe(matched[i - 1]!.clips[0]!.clipId);
      }
    }
  });

  it("with pool N and 2N adjacent sections, every clip is used exactly twice and reshuffle preserves no-repeat", () => {
    const clips = [
      makeClip("hook-01", 8000),
      makeClip("hook-02", 8000),
      makeClip("hook-03", 8000),
      makeClip("hook-04", 8000),
    ];
    const map = buildClipsByBaseName(clips);
    const sections = Array.from({ length: 8 }, () => makeSection("Hook", 3000));
    for (let trial = 0; trial < 100; trial++) {
      const matched = matchSections(sections, map);
      const usage = new Map<string, number>();
      for (const m of matched) {
        const id = m.clips[0]!.clipId;
        usage.set(id, (usage.get(id) ?? 0) + 1);
      }
      expect(usage.size).toBe(4);
      for (const count of usage.values()) expect(count).toBe(2);
      for (let i = 1; i < matched.length; i++) {
        expect(matched[i]!.clips[0]!.clipId).not.toBe(matched[i - 1]!.clips[0]!.clipId);
      }
    }
  });

  it("with pool of 1, must reuse — no crash, no infinite loop", () => {
    const clips = [makeClip("hook-01", 8000)];
    const map = buildClipsByBaseName(clips);
    const sections = Array.from({ length: 3 }, () => makeSection("Hook", 3000));
    const matched = matchSections(sections, map);
    expect(matched).toHaveLength(3);
    for (const m of matched) expect(m.clips[0]!.clipId).toBe("hook-01");
  });

  it("eligibility still respected — clips shorter than section never picked", () => {
    const clips = [
      makeClip("hook-01", 1000),
      makeClip("hook-02", 1000),
      makeClip("hook-03", 8000),
      makeClip("hook-04", 8000),
    ];
    const map = buildClipsByBaseName(clips);
    const sections = Array.from({ length: 6 }, () => makeSection("Hook", 3000));
    for (let trial = 0; trial < 50; trial++) {
      const matched = matchSections(sections, map);
      for (const m of matched) {
        expect(["hook-03", "hook-04"]).toContain(m.clips[0]!.clipId);
      }
    }
  });

  it("queues are isolated per tag — interleaving doesn't share state", () => {
    const clips = [
      makeClip("hook-01", 8000), makeClip("hook-02", 8000),
      makeClip("intro-01", 8000), makeClip("intro-02", 8000),
    ];
    const map = buildClipsByBaseName(clips);
    const sections: ParsedSection[] = [
      makeSection("Hook", 3000),
      makeSection("Intro", 3000),
      makeSection("Hook", 3000),
      makeSection("Intro", 3000),
    ];
    for (let trial = 0; trial < 100; trial++) {
      const matched = matchSections(sections, map);
      expect(matched[0]!.clips[0]!.clipId).not.toBe(matched[2]!.clips[0]!.clipId);
      expect(matched[1]!.clips[0]!.clipId).not.toBe(matched[3]!.clips[0]!.clipId);
    }
  });
});

describe("matchSections — distribution & shortest-fit", () => {
  it("least-used first: across many sections, usage is distributed evenly across the pool", () => {
    // 4 equal-duration clips, 100 same-tag sections. Max-min usage gap should be ≤ 1.
    const clips = [
      makeClip("hook-01", 8000),
      makeClip("hook-02", 8000),
      makeClip("hook-03", 8000),
      makeClip("hook-04", 8000),
    ];
    const map = buildClipsByBaseName(clips);
    const sections = Array.from({ length: 100 }, () => makeSection("Hook", 3000));
    const matched = matchSections(sections, map);
    const usage = new Map<string, number>();
    for (const m of matched) {
      const id = m.clips[0]!.clipId;
      usage.set(id, (usage.get(id) ?? 0) + 1);
    }
    expect(usage.size).toBe(4);
    const counts = [...usage.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("cooldown window: no clip reused within (poolSize − 1) consecutive sections", () => {
    // Pool of 5 → cooldown = 4. Across 50 sections, no clipId repeats inside any window of 5.
    const clips = [
      makeClip("hook-01", 8000),
      makeClip("hook-02", 8000),
      makeClip("hook-03", 8000),
      makeClip("hook-04", 8000),
      makeClip("hook-05", 8000),
    ];
    const map = buildClipsByBaseName(clips);
    const sections = Array.from({ length: 50 }, () => makeSection("Hook", 3000));
    for (let trial = 0; trial < 50; trial++) {
      const ids = matchSections(sections, map).map((m) => m.clips[0]!.clipId);
      for (let i = 0; i + 5 <= ids.length; i++) {
        expect(new Set(ids.slice(i, i + 5)).size).toBe(5);
      }
    }
  });

  it("shortest-fit reservation: long clips are reserved for sections that need them", () => {
    // Mix of short and long clips; short sections should consume the short clips so long
    // sections still have long clips available. With 4 short (4s) and 4 long (10s) clips,
    // 4 short sections (3s) and 4 long sections (8s), the short sections should never
    // pick a 10s clip while a 4s clip is still least-used.
    const clips = [
      makeClip("hook-01", 4000), makeClip("hook-02", 4000),
      makeClip("hook-03", 4000), makeClip("hook-04", 4000),
      makeClip("hook-05", 10000), makeClip("hook-06", 10000),
      makeClip("hook-07", 10000), makeClip("hook-08", 10000),
    ];
    const map = buildClipsByBaseName(clips);
    const shortIds = new Set(["hook-01", "hook-02", "hook-03", "hook-04"]);
    const sections: ParsedSection[] = [
      makeSection("Hook", 3000), makeSection("Hook", 3000),
      makeSection("Hook", 3000), makeSection("Hook", 3000),
      makeSection("Hook", 8000), makeSection("Hook", 8000),
      makeSection("Hook", 8000), makeSection("Hook", 8000),
    ];
    for (let trial = 0; trial < 50; trial++) {
      const matched = matchSections(sections, map);
      // First 4 (short) sections should pick from the short pool.
      for (let i = 0; i < 4; i++) {
        expect(shortIds.has(matched[i]!.clips[0]!.clipId)).toBe(true);
      }
    }
  });
});

describe("buildManualChain", () => {
  const clipA = { id: "a", fileId: "a-key", durationMs: 2500 } as ClipMetadata;
  const clipB = { id: "b", fileId: "b-key", durationMs: 3400 } as ClipMetadata;

  it("produces uniform speedFactor across all picks", () => {
    const chain = buildManualChain([clipA, clipB], 5000);
    expect(chain).toHaveLength(2);
    const expected = (2500 + 3400) / 5000;
    expect(chain[0]!.speedFactor).toBeCloseTo(expected, 4);
    expect(chain[1]!.speedFactor).toBeCloseTo(expected, 4);
  });

  it("preserves clipId and fileId for each pick in order", () => {
    const chain = buildManualChain([clipA, clipB], 5000);
    expect(chain[0]!.clipId).toBe("a");
    expect(chain[0]!.fileId).toBe("a-key");
    expect(chain[1]!.clipId).toBe("b");
    expect(chain[1]!.fileId).toBe("b-key");
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
    expect(chain[0]!.fileId).toBe("");
    expect(chain[0]!.speedFactor).toBe(1);
  });
});

describe("matchSections — absolute positioning", () => {
  it("propagates startMs and endMs from the input ParsedSection", () => {
    const clips = [makeClip("hook-01", 5000)];
    const map = buildClipsByBaseName(clips);
    const ps: ParsedSection = {
      lineNumber: 1,
      startTime: 12.5,           // 12500ms
      endTime: 16.0,             // 16000ms
      tag: "Hook",
      scriptText: "x",
      durationMs: 3500,
    };
    const matched = matchSections([ps], map)[0]!;
    expect(matched.startMs).toBe(12500);
    expect(matched.endMs).toBe(16000);
    expect(matched.durationMs).toBe(3500);
  });

  it("propagates startMs/endMs even for placeholder (no matching tag) sections", () => {
    const ps: ParsedSection = {
      lineNumber: 1,
      startTime: 5,
      endTime: 8,
      tag: "unknown",
      scriptText: "x",
      durationMs: 3000,
    };
    const matched = matchSections([ps], new Map())[0]!;
    expect(matched.clips[0]!.isPlaceholder).toBe(true);
    expect(matched.startMs).toBe(5000);
    expect(matched.endMs).toBe(8000);
  });

  it("propagates startMs/endMs for zero-duration sections", () => {
    const ps: ParsedSection = {
      lineNumber: 1,
      startTime: 7,
      endTime: 7,
      tag: "Hook",
      scriptText: "x",
      durationMs: 0,
    };
    const matched = matchSections([ps], new Map())[0]!;
    expect(matched.startMs).toBe(7000);
    expect(matched.endMs).toBe(7000);
    expect(matched.durationMs).toBe(0);
  });
});
