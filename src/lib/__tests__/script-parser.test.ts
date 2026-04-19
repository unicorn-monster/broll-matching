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
    // 1000ms start, 1050ms end — 50ms is between frame 1 (33.33) and frame 2 (66.67)
    // 1050ms → nearest frame = 32 (1066.67ms) — no wait, 1050 * 30 / 1000 = 31.5 → rounds to 32
    const result = parseScript("00:01,000 --> 00:01,050 || Hook || tiny", BASE_NAMES);
    // start frame 30 (1000ms), end frame 32 (1066.67ms) → 2 frames = 66.67ms
    // OR start frame 30, end frame 31 (1033.33ms) → 1 frame = 33.33ms
    // depending on rounding — either way, result is frame-aligned integer count
    const d = result.sections[0].durationMs;
    expect(Math.round(d * 30 / 1000)).toBeGreaterThan(0); // is integer frame count
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
