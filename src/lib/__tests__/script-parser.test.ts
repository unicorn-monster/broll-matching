import { describe, it, expect } from "vitest";
import { parseScript } from "../script-parser";

const BASE_NAMES = new Set(["hook", "fs-clipper-freakout", "ump-compressthenail", "before-after"]);

describe("parseScript — SRT-style", () => {
  it("parses HH:MM:SS,mmm --> HH:MM:SS,mmm cue", () => {
    const result = parseScript("00:00:01,250 --> 00:00:02,833 || Hook || Intro text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      tag: "Hook",
      scriptText: "Intro text",
    });
    // 1250ms → frame 38 (1266.67ms), 2833ms → frame 85 (2833.33ms)
    // durationMs = 85 frames - 38 frames = 47 frames = 1566.67ms
    expect(result.sections[0].durationMs).toBeCloseTo(1566.6667, 3);
  });

  it("parses MM:SS,mmm shorthand", () => {
    const result = parseScript("00:01,250 --> 00:02,833 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts legacy MM:SS (no ms, treated as ,000)", () => {
    const result = parseScript("00:00 --> 00:04 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections[0].durationMs).toBe(4000); // frame-aligned: 4s = 120 frames exact
  });

  it("snaps start/end to frame boundaries", () => {
    // 1050ms: 1050 * 30 / 1000 = 31.5 → rounds to frame 32 (1066.67ms)
    const result = parseScript("00:01,000 --> 00:01,050 || Hook || tiny", BASE_NAMES);
    const d = result.sections[0].durationMs;
    const frameCount = (d * 30) / 1000;
    // duration must land exactly on a frame boundary (integer frame count)
    expect(Math.abs(frameCount - Math.round(frameCount))).toBeLessThan(1e-9);
    expect(Math.round(frameCount)).toBeGreaterThan(0);
  });

  it("skips blank lines", () => {
    const result = parseScript("\n00:00 --> 00:04 || Hook || text\n\n", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
  });

  it("errors on invalid line", () => {
    const result = parseScript("not a valid line", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
  });

  it("warns on unknown tag (case-insensitive)", () => {
    const result = parseScript("00:00 --> 00:04 || UnknownTag || text", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("UnknownTag"))).toBe(true);
  });

  it("matches tags case-insensitively", () => {
    const result = parseScript("00:00 --> 00:04 || FS-CLIPPER-FREAKOUT || text", BASE_NAMES);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on zero-duration section", () => {
    const result = parseScript("00:00,000 --> 00:00,000 || Hook || text", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("zero"))).toBe(true);
  });

  it("errors on reversed timestamps (end before start)", () => {
    const result = parseScript("00:00:05,000 --> 00:00:03,000 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/end time is before start time/i);
    expect(result.sections).toHaveLength(0);
  });

  it("accepts hyphen separator (CapCut variant)", () => {
    const result = parseScript("00:00:00,000 - 00:00:02,833 ||Hook|| text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].tag).toBe("Hook");
  });

  it("accepts en-dash separator", () => {
    const result = parseScript("00:00:00,000 \u2013 00:00:02,833 ||Hook|| text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts em-dash separator", () => {
    const result = parseScript("00:00:00,000 \u2014 00:00:02,833 ||Hook|| text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("accepts period as decimal separator (HH:MM:SS.mmm)", () => {
    const result = parseScript("00:00:00.000 - 00:00:02.833 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].tag).toBe("Hook");
  });

  it("accepts period decimal separator with --> and produces same duration as comma form", () => {
    const withPeriod = parseScript("00:00:01.250 --> 00:00:02.833 || Hook || text", BASE_NAMES);
    const withComma = parseScript("00:00:01,250 --> 00:00:02,833 || Hook || text", BASE_NAMES);
    expect(withPeriod.errors).toHaveLength(0);
    expect(withPeriod.sections[0].durationMs).toBe(withComma.sections[0].durationMs);
  });

  it("accepts mixed comma and period decimal separators on same line", () => {
    const result = parseScript("00:00:01,250 --> 00:00:02.833 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
  });

  it("handles multi-line SRT-style script", () => {
    const input = [
      "00:00:00,000 --> 00:00:04,000 || Hook || Line one",
      "00:00:04,000 --> 00:00:10,500 || FS-clipper-freakout || Line two",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.sections).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});
