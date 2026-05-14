import { describe, it, expect } from "vitest";
import { wrapTextToLines, computeOverlayPixelBox } from "../text-overlay-render";
import { DEFAULT_TEXT_STYLE } from "../text-style-defaults";

// Minimal mock of CanvasRenderingContext2D.measureText.
// Each character has fixed advance = 10px regardless of font.
const mockCtx = {
  measureText: (s: string) => ({ width: s.length * 10 }),
} as unknown as CanvasRenderingContext2D;

describe("wrapTextToLines", () => {
  it("returns a single line when text fits", () => {
    const lines = wrapTextToLines(mockCtx, "hello world", 200);
    expect(lines).toEqual(["hello world"]);
  });

  it("breaks on word boundaries when exceeding maxWidthPx", () => {
    // 'foo bar baz' = 'foo'(30) + ' '(10) + 'bar'(30) = 70 fits in 80; then ' baz'(40) overflows.
    const lines = wrapTextToLines(mockCtx, "foo bar baz", 80);
    expect(lines).toEqual(["foo bar", "baz"]);
  });

  it("respects explicit newlines from the user", () => {
    const lines = wrapTextToLines(mockCtx, "foo\nbar baz", 1000);
    expect(lines).toEqual(["foo", "bar baz"]);
  });

  it("breaks a single overlong token onto its own line without crashing", () => {
    const lines = wrapTextToLines(mockCtx, "supercalifragilistic", 50);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join(" ")).toBe("supercalifragilistic");
  });
});

describe("computeOverlayPixelBox", () => {
  const outW = 1080;
  const outH = 1920;

  it("places the box centered horizontally at default style", () => {
    const box = computeOverlayPixelBox(mockCtx, "hello", DEFAULT_TEXT_STYLE, outW, outH);
    expect(box.lines).toEqual(["hello"]);
    // Width = textWidth + 2*paddingX. Mock text 'hello' = 50px wide.
    const padX = Math.round(DEFAULT_TEXT_STYLE.bgPaddingXFrac * outW);
    const expectedWidth = 50 + 2 * padX;
    expect(box.width).toBe(expectedWidth);
    // Box centered: x = (outW * positionXFrac) - width/2.
    expect(box.x).toBe(Math.round(outW * 0.5 - expectedWidth / 2));
  });

  it("anchors the box bottom at positionYFrac (anchor = bottom-center of caption)", () => {
    const box = computeOverlayPixelBox(mockCtx, "hello", DEFAULT_TEXT_STYLE, outW, outH);
    expect(box.y + box.height).toBe(Math.round(outH * 0.85));
  });
});
