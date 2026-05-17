/**
 * Pure ffmpeg argument builders for the server-side render pipeline.
 *
 * Each builder returns the exact `string[]` to spawn `ffmpeg` with — no IO,
 * no spawning, no path resolution. This keeps the render route thin and lets
 * us unit-test the (otherwise opaque) ffmpeg invocations in isolation.
 *
 * All builders produce MPEG-TS output so the final concat step can `-c copy`
 * without re-encoding (every segment shares identical codec params).
 */

export const FPS = 30;

/**
 * Overlay (talking-head PIP) layout constants. Kept here — not in route.ts —
 * so the unit tests can assert on them without importing route handler code.
 */
export const OVERLAY_WIDTH_RATIO = 0.3;
export const OVERLAY_PADDING_PX = 24;
export const OVERLAY_ANCHOR: "bottom-right" = "bottom-right";

interface Common {
  outputWidth: number;
  outputHeight: number;
  outPath: string;
}

/**
 * Black filler segment — used for leading/trailing gaps where the timeline
 * has no clip but the audio still plays.
 */
export function buildBlackGapArgs(
  args: { durationMs: number } & Common,
): string[] {
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${args.outputWidth}x${args.outputHeight}:r=${FPS}:d=${args.durationMs / 1000}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    args.outPath,
  ];
}

interface BaseTalkingHead {
  kind: "talking-head";
  inputPath: string;
  sourceSeekMs: number;
  trimDurationMs: number;
}

interface BaseBroll {
  kind: "broll";
  inputPath: string;
  trimDurationMs?: number;
  speedFactor: number;
}

interface BasePlaceholder {
  kind: "placeholder";
  durationMs: number;
}

/**
 * Build the args for a single timeline segment's *base* layer.
 *
 * - `talking-head`: seek inside source before opening input (fast, accurate
 *   since ffmpeg ≥ 2.1), then trim to section length. PTS reset via
 *   `setpts=PTS-STARTPTS` to avoid timestamp discontinuities in MPEG-TS.
 * - `broll`: open from start, optionally trim, apply speed via setpts.
 * - `placeholder`: delegate to `buildBlackGapArgs` for a black slug.
 */
export function buildBaseSegmentArgs(
  args: (BaseTalkingHead | BaseBroll | BasePlaceholder) & Common,
): string[] {
  const { outputWidth: W, outputHeight: H, outPath } = args;
  const scaleAndPad =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;

  if (args.kind === "placeholder") {
    return buildBlackGapArgs({
      durationMs: args.durationMs,
      outputWidth: W,
      outputHeight: H,
      outPath,
    });
  }

  if (args.kind === "talking-head") {
    return [
      "-y",
      "-ss", String(args.sourceSeekMs / 1000), // input seek — discards frames before this point
      "-i", args.inputPath,
      "-t", String(args.trimDurationMs / 1000),
      "-vf", `${scaleAndPad},setpts=PTS-STARTPTS`,
      "-an",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "fastdecode",
      "-pix_fmt", "yuv420p",
      "-r", String(FPS),
      "-f", "mpegts",
      outPath,
    ];
  }

  // b-roll
  return [
    "-y",
    "-i", args.inputPath,
    ...(args.trimDurationMs ? ["-t", String(args.trimDurationMs / 1000)] : []),
    "-vf",
      `${scaleAndPad},setpts=${(1 / args.speedFactor).toFixed(4)}*PTS`,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    outPath,
  ];
}

/**
 * Composite a talking-head PIP over an already-rendered base segment.
 *
 * Input 0 is the base MPEG-TS, input 1 is the matted overlay (webm w/ alpha
 * or similar). The overlay is scaled to OVERLAY_WIDTH_RATIO of base width,
 * positioned bottom-right with OVERLAY_PADDING_PX margin, and the composite
 * ends with `shortest=1` so the overlay can be any length ≥ trim duration
 * without affecting output length.
 */
export function buildOverlayMergeArgs(
  args: {
    basePath: string;
    overlayPath: string;
    sourceSeekMs: number;
    trimDurationMs: number;
  } & Common,
): string[] {
  const { outPath } = args;
  const filter =
    `[1:v]scale=iw*${OVERLAY_WIDTH_RATIO}:-2,setpts=PTS-STARTPTS[fg];` +
    `[0:v][fg]overlay=W-overlay_w-${OVERLAY_PADDING_PX}:H-overlay_h-${OVERLAY_PADDING_PX}:shortest=1[v]`;
  return [
    "-y",
    "-i", args.basePath,
    "-ss", String(args.sourceSeekMs / 1000),
    "-i", args.overlayPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-t", String(args.trimDurationMs / 1000),
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    outPath,
  ];
}
