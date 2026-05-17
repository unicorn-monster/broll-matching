import { describe, expect, it } from "vitest";
import {
  buildBaseSegmentArgs,
  buildBlackGapArgs,
  buildOverlayMergeArgs,
  OVERLAY_PADDING_PX,
  OVERLAY_WIDTH_RATIO,
} from "../render-segments";

describe("buildBlackGapArgs", () => {
  it("produces a 1080x1920 black segment of the requested duration", () => {
    const args = buildBlackGapArgs({
      outputWidth: 1080,
      outputHeight: 1920,
      durationMs: 2000,
      outPath: "/tmp/gap.ts",
    });
    expect(args).toContain("-i");
    expect(args.join(" ")).toMatch(/color=c=black:s=1080x1920:r=30:d=2/);
    expect(args).toContain("/tmp/gap.ts");
  });
});

describe("buildBaseSegmentArgs — talking-head slice", () => {
  it("uses input-seek and trims to section duration", () => {
    const args = buildBaseSegmentArgs({
      kind: "talking-head",
      inputPath: "/tmp/in.mp4",
      sourceSeekMs: 30000,
      trimDurationMs: 15000,
      outputWidth: 1080,
      outputHeight: 1920,
      outPath: "/tmp/seg.ts",
    });
    const joined = args.join(" ");
    expect(joined).toMatch(/-ss 30(?:\.0+)?/);
    expect(joined).toMatch(/-t 15(?:\.0+)?/);
  });
});

describe("buildOverlayMergeArgs", () => {
  it("scales overlay to 30% width and positions bottom-right with 24px padding", () => {
    const args = buildOverlayMergeArgs({
      basePath: "/tmp/base.mp4",
      overlayPath: "/tmp/matted.webm",
      sourceSeekMs: 30000,
      trimDurationMs: 15000,
      outputWidth: 1080,
      outputHeight: 1920,
      outPath: "/tmp/merged.ts",
    });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toMatch(new RegExp(`scale=iw\\*${OVERLAY_WIDTH_RATIO.toString().replace(".", "\\.")}`));
    expect(filter).toMatch(new RegExp(`overlay=W-overlay_w-${OVERLAY_PADDING_PX}:H-overlay_h-${OVERLAY_PADDING_PX}`));
    expect(filter).toMatch(/shortest=1/);
    expect(args.join(" ")).toMatch(/-ss 30/);
    expect(args.join(" ")).toMatch(/-t 15/);
  });
});
