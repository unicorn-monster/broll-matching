import { describe, it, expect } from "vitest";
import { DEFAULT_TEXT_STYLE, AVAILABLE_FONTS } from "../text-style-defaults";

describe("DEFAULT_TEXT_STYLE", () => {
  it("matches the design spec defaults", () => {
    expect(DEFAULT_TEXT_STYLE.fontFamily).toBe("Inter");
    expect(DEFAULT_TEXT_STYLE.fontWeight).toBe(500);
    expect(DEFAULT_TEXT_STYLE.fontSizeFrac).toBeCloseTo(0.04);
    expect(DEFAULT_TEXT_STYLE.textColor).toBe("#000000");
    expect(DEFAULT_TEXT_STYLE.bgMode).toBe("per-line");
    expect(DEFAULT_TEXT_STYLE.bgColor).toBe("#ffffff");
    expect(DEFAULT_TEXT_STYLE.bgOpacity).toBe(1);
    expect(DEFAULT_TEXT_STYLE.strokeEnabled).toBe(false);
    expect(DEFAULT_TEXT_STYLE.alignment).toBe("center");
    expect(DEFAULT_TEXT_STYLE.positionXFrac).toBeCloseTo(0.5);
    expect(DEFAULT_TEXT_STYLE.positionYFrac).toBeCloseTo(0.85);
    expect(DEFAULT_TEXT_STYLE.maxWidthFrac).toBeCloseTo(0.8);
  });

  it("registers Inter, Roboto, and Open Sans as available fonts", () => {
    expect(AVAILABLE_FONTS).toEqual([
      { id: "Inter", label: "Classic" },
      { id: "Roboto", label: "Roboto" },
      { id: "Open Sans", label: "Open Sans" },
    ]);
  });
});
