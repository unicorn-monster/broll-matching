import { describe, it, expect } from "vitest";
import { parseScript } from "../script-parser";

const BASE_NAMES = new Set(["hook", "fs-clipper-freakout", "ump-compressthenail", "before-after"]);

describe("parseScript", () => {
  it("parses valid HH:MM:SS line", () => {
    const result = parseScript("00:00:00 - 00:00:04 || Hook || Intro text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      startTime: 0,
      endTime: 4,
      tag: "Hook",
      scriptText: "Intro text",
      durationMs: 4000,
    });
  });

  it("parses MM:SS shorthand", () => {
    const result = parseScript("00:00 - 00:04 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections[0].startTime).toBe(0);
    expect(result.sections[0].endTime).toBe(4);
  });

  it("skips blank lines", () => {
    const result = parseScript("\n00:00 - 00:04 || Hook || text\n\n", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
  });

  it("errors on invalid line", () => {
    const result = parseScript("not a valid line", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
  });

  it("warns on unknown tag (case-insensitive)", () => {
    const result = parseScript("00:00 - 00:04 || UnknownTag || text", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
    expect(result.warnings.some((w) => w.message.includes("UnknownTag"))).toBe(true);
  });

  it("matches tags case-insensitively", () => {
    const result = parseScript("00:00 - 00:04 || FS-CLIPPER-FREAKOUT || text", BASE_NAMES);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on zero-duration section", () => {
    const result = parseScript("00:00 - 00:00 || Hook || text", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("zero"))).toBe(true);
  });

  it("handles multi-line script", () => {
    const input = [
      "00:00 - 00:04 || Hook || Line one",
      "00:04 - 00:10 || FS-clipper-freakout || Line two",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.sections).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});
