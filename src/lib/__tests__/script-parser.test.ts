import { describe, it, expect } from "vitest";
import { parseScript } from "../script-parser";

const BASE_NAMES = new Set(["hook", "fs-clipper-freakout", "ump-compressthenail", "before-after"]);

describe("parseScript — SRT-style", () => {
  it("parses HH:MM:SS,mmm --> HH:MM:SS,mmm cue", () => {
    const result = parseScript("00:00:01,250 --> 00:00:02,833 || Intro text || Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.tags[0]).toBe("Hook");
    expect(result.sections[0]!.scriptText).toBe("Intro text");
    // 1250ms → frame 38 (1266.67ms), 2833ms → frame 85 (2833.33ms)
    // durationMs = 85 frames - 38 frames = 47 frames = 1566.67ms
    expect(result.sections[0]!.durationMs).toBeCloseTo(1566.6667, 3);
  });

  it("parses MM:SS,mmm shorthand", () => {
    const result = parseScript("00:01,250 --> 00:02,833 || text || Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts legacy MM:SS (no ms, treated as ,000)", () => {
    const result = parseScript("00:00 --> 00:04 || text || Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections[0]!.durationMs).toBe(4000); // frame-aligned: 4s = 120 frames exact
  });

  it("snaps start/end to frame boundaries", () => {
    // 1050ms: 1050 * 30 / 1000 = 31.5 → rounds to frame 32 (1066.67ms)
    const result = parseScript("00:01,000 --> 00:01,050 || tiny || Hook", BASE_NAMES);
    const d = result.sections[0]!.durationMs;
    const frameCount = (d * 30) / 1000;
    // duration must land exactly on a frame boundary (integer frame count)
    expect(Math.abs(frameCount - Math.round(frameCount))).toBeLessThan(1e-9);
    expect(Math.round(frameCount)).toBeGreaterThan(0);
  });

  it("skips blank lines", () => {
    const result = parseScript("\n00:00 --> 00:04 || text || Hook\n\n", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
  });

  it("errors on invalid line", () => {
    const result = parseScript("not a valid line", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
  });

  it("warns on unknown tag (case-insensitive)", () => {
    const result = parseScript("00:00 --> 00:04 || text || UnknownTag", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("UnknownTag"))).toBe(true);
  });

  it("matches tags case-insensitively", () => {
    const result = parseScript("00:00 --> 00:04 || text || FS-CLIPPER-FREAKOUT", BASE_NAMES);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on zero-duration section", () => {
    const result = parseScript("00:00,000 --> 00:00,000 || text || Hook", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("zero"))).toBe(true);
  });

  it("errors on reversed timestamps (end before start)", () => {
    const result = parseScript("00:00:05,000 --> 00:00:03,000 || text || Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/end time is before start time/i);
    expect(result.sections).toHaveLength(0);
  });

  it("accepts hyphen separator (CapCut variant)", () => {
    const result = parseScript("00:00:00,000 - 00:00:02,833 || text ||Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.tags[0]).toBe("Hook");
  });

  it("accepts en-dash separator", () => {
    const result = parseScript("00:00:00,000 \u2013 00:00:02,833 || text ||Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts em-dash separator", () => {
    const result = parseScript("00:00:00,000 \u2014 00:00:02,833 || text ||Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts period as decimal separator (HH:MM:SS.mmm)", () => {
    const result = parseScript("00:00:00.000 - 00:00:02.833 || text || Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.tags[0]).toBe("Hook");
  });

  it("accepts period decimal separator with --> and produces same duration as comma form", () => {
    const withPeriod = parseScript("00:00:01.250 --> 00:00:02.833 || text || Hook", BASE_NAMES);
    const withComma = parseScript("00:00:01,250 --> 00:00:02,833 || text || Hook", BASE_NAMES);
    expect(withPeriod.errors).toHaveLength(0);
    expect(withPeriod.sections[0]!.durationMs).toBe(withComma.sections[0]!.durationMs);
  });

  it("accepts mixed comma and period decimal separators on same line", () => {
    const result = parseScript("00:00:01,250 --> 00:00:02.833 || text || Hook", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("handles multi-line SRT-style script", () => {
    const input = [
      "00:00:00,000 --> 00:00:04,000 || Line one || Hook",
      "00:00:04,000 --> 00:00:10,500 || Line two || FS-clipper-freakout",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.sections).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});

describe("parseScript — overlap detection", () => {
  it("errors when two lines overlap, pointing at the later line", () => {
    const input = [
      "00:00:01,000 --> 00:00:05,000 || first || Hook",
      "00:00:03,000 --> 00:00:07,000 || overlaps first || Hook",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toMatch(/overlap/i);
  });

  it("accepts adjacent lines that touch (curr.startMs === prev.endMs) — no overlap", () => {
    const input = [
      "00:00:01,000 --> 00:00:05,000 || first || Hook",
      "00:00:05,000 --> 00:00:07,000 || touches || Hook",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts lines with a gap between them", () => {
    const input = [
      "00:00:01,000 --> 00:00:05,000 || first || Hook",
      "00:00:10,000 --> 00:00:12,000 || far later || Hook",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors).toHaveLength(0);
  });

  it("detects overlap regardless of line order in the script", () => {
    // Second-listed line starts earlier and overlaps the first line.
    const input = [
      "00:00:05,000 --> 00:00:09,000 || late line || Hook",
      "00:00:00,000 --> 00:00:06,000 || early line, overlaps || Hook",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => /overlap/i.test(e.message))).toBe(true);
  });
});

describe("parseScript — audio bound check", () => {
  it("errors when endTime exceeds audioDurationMs", () => {
    const result = parseScript(
      "00:00:08,000 --> 00:00:12,000 || past end || Hook",
      BASE_NAMES,
      10_000, // audio is 10s, line ends at 12s
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toMatch(/audio/i);
  });

  it("accepts endTime equal to audioDurationMs (boundary inclusive)", () => {
    const result = parseScript(
      "00:00:08,000 --> 00:00:10,000 || ends right at end || Hook",
      BASE_NAMES,
      10_000,
    );
    expect(result.errors).toHaveLength(0);
  });

  it("accepts endTime equal to audioDurationMs when timestamp is NOT frame-aligned", () => {
    // 315533ms = 5:15.533 is NOT on a 30fps frame boundary; raw frame index
    // is 9465.99 which rounds to 9466 → snapped end = 315533.333ms.
    // Validation must compare the raw user-typed timestamp against audio
    // duration, not the frame-snapped derivative — otherwise sub-frame
    // snap drift causes a false positive.
    const result = parseScript(
      "00:00:00,000 --> 00:05:15,533 || ends exactly at audio end || Hook",
      BASE_NAMES,
      315_533,
    );
    expect(result.errors.filter((e) => /audio/i.test(e.message))).toHaveLength(0);
  });

  it("skips bound check when audioDurationMs is null (audio not loaded yet)", () => {
    const result = parseScript(
      "00:00:08,000 --> 00:00:120,000 || would normally fail || Hook",
      BASE_NAMES,
      null,
    );
    expect(result.errors.filter((e) => /audio/i.test(e.message))).toHaveLength(0);
  });
});

describe("multi-tag parsing", () => {
  const folders = new Set(["mower", "hook"]);

  it("parses a single tag into a one-element tags array", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower", folders);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]!.tags).toEqual(["mower"]);
  });

  it("parses `tag1, tag2` (comma + space)", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower, talking-head-overlay", folders);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]!.tags).toEqual(["mower", "talking-head-overlay"]);
  });

  it("tolerates extra whitespace (`mower ,  talking-head-overlay`)", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower ,  talking-head-overlay", folders);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]!.tags).toEqual(["mower", "talking-head-overlay"]);
  });

  it("errors on 3+ tags", () => {
    const r = parseScript("00:00 --> 00:05 || hi || a, b, c", folders);
    expect(r.errors[0]!.message).toMatch(/max 2 tags/);
  });

  it("errors on two base tags", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower, hook", folders);
    expect(r.errors[0]!.message).toMatch(/only one base tag allowed/);
  });

  it("errors on duplicate overlay tag", () => {
    const r = parseScript(
      "00:00 --> 00:05 || hi || talking-head-overlay, talking-head-overlay",
      folders,
    );
    expect(r.errors[0]!.message).toMatch(/duplicate.*talking-head-overlay/i);
  });

  it("warns on legacy `talking-head` tag and suggests `talking-head-full`", () => {
    const r = parseScript("00:00 --> 00:05 || hi || talking-head", folders);
    expect(r.warnings.some((w) => /talking-head-full/.test(w.message))).toBe(true);
  });
});
