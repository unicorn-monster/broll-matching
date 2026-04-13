/**
 * Render pipeline — runs on the main thread.
 *
 * @ffmpeg/ffmpeg v0.12 already executes WASM off the main thread via its own
 * internal web worker, so individual ffmpeg.exec() calls are non-blocking.
 * A fresh FFmpeg instance is created per render to avoid sharing the virtual
 * filesystem with the upload pipeline.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { getClip } from "@/lib/clip-storage";
import { PLACEHOLDER_CLIP_ID, type MatchedSection } from "@/lib/auto-match";
import type { ParsedSection } from "@/lib/script-parser";

const CDN_BASE = "https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd";

export type RenderPhase = "loading" | "rendering" | "muxing";

export interface RenderProgress {
  phase: RenderPhase;
  currentSegment: number;
  totalSegments: number;
}

export interface RenderInput {
  matchedSections: MatchedSection[];
  sections: ParsedSection[];
  audioFile: File;
  onProgress: (p: RenderProgress) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadFreshFFmpeg(): Promise<FFmpeg> {
  const ff = new FFmpeg();
  await ff.load({
    coreURL: await toBlobURL(`${CDN_BASE}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CDN_BASE}/ffmpeg-core.wasm`, "application/wasm"),
  });
  return ff;
}

async function buildBlackSegment(
  ff: FFmpeg,
  durationSec: number,
  outFile: string
): Promise<void> {
  await ff.exec([
    "-f", "lavfi",
    "-i", `color=c=black:s=1080x1350:r=30:d=${durationSec}`,
    "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
    outFile,
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full render pipeline and return the final MP4 as an ArrayBuffer.
 * Progress is reported via the `onProgress` callback.
 * All temporary virtual-FS files are cleaned up before returning.
 */
export async function runRender(input: RenderInput): Promise<ArrayBuffer> {
  const { matchedSections, sections, audioFile, onProgress } = input;

  // Sort sections by their original order
  const sorted = [...matchedSections].sort(
    (a, b) => a.sectionIndex - b.sectionIndex
  );

  // Count total segments
  const totalSegments = sorted.reduce(
    (sum, ms) => sum + Math.max(ms.clips.length, 1),
    0
  );

  // ----- Phase: load -------------------------------------------------------
  onProgress({ phase: "loading", currentSegment: 0, totalSegments });
  const ff = await loadFreshFFmpeg();

  // Write audio
  const audioBuffer = await audioFile.arrayBuffer();
  await ff.writeFile("audio.mp3", new Uint8Array(audioBuffer));

  let segIdx = 0;
  const segFiles: string[] = [];

  // ----- Phase: render segments --------------------------------------------
  for (const ms of sorted) {
    const section = sections[ms.sectionIndex];
    if (!section) continue;

    if (ms.clips.length === 0) {
      // Zero-duration section — emit a tiny black frame segment so concat still works
      const segFile = `seg_${segIdx}.mp4`;
      await buildBlackSegment(ff, 0.001, segFile);
      segFiles.push(segFile);
      segIdx++;
      onProgress({ phase: "rendering", currentSegment: segIdx, totalSegments });
      continue;
    }

    for (const mc of ms.clips) {
      const segFile = `seg_${segIdx}.mp4`;

      // ---- placeholder (no real clip) -------------------------------------
      if (mc.isPlaceholder || mc.clipId === PLACEHOLDER_CLIP_ID) {
        await buildBlackSegment(ff, section.durationMs / 1000, segFile);

      // ---- real clip ------------------------------------------------------
      } else {
        const clipData = await getClip(mc.clipId);

        if (!clipData) {
          // Clip missing from IndexedDB — fall back to black
          await buildBlackSegment(ff, section.durationMs / 1000, segFile);
        } else {
          const inFile = `clip_${segIdx}.mp4`;
          await ff.writeFile(inFile, new Uint8Array(clipData));

          if (mc.speedFactor === 1.0 && !mc.trimDurationMs) {
            // 1× speed — copy stream directly (fastest path)
            await ff.exec(["-i", inFile, "-c:v", "copy", segFile]);
          } else {
            // Speed or trim+speed
            const setpts = (1 / mc.speedFactor).toFixed(6);
            const args: string[] = ["-i", inFile];
            if (mc.trimDurationMs) {
              args.push("-t", (mc.trimDurationMs / 1000).toString());
            }
            args.push(
              "-vf", `setpts=${setpts}*PTS`,
              "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
              segFile
            );
            await ff.exec(args);
          }

          await ff.deleteFile(inFile);
        }
      }

      segFiles.push(segFile);
      segIdx++;
      onProgress({ phase: "rendering", currentSegment: segIdx, totalSegments });
    }
  }

  if (segFiles.length === 0) {
    throw new Error("No video segments were generated.");
  }

  // ----- Phase: mux --------------------------------------------------------
  onProgress({ phase: "muxing", currentSegment: totalSegments, totalSegments });

  const concatContent = segFiles.map((f) => `file '${f}'`).join("\n");
  await ff.writeFile("concat.txt", new TextEncoder().encode(concatContent));

  await ff.exec([
    "-f", "concat", "-safe", "0", "-i", "concat.txt",
    "-i", "audio.mp3",
    "-c:v", "copy", "-c:a", "aac", "-shortest",
    "output.mp4",
  ]);

  const outputData = (await ff.readFile("output.mp4")) as Uint8Array;

  // ----- Cleanup -----------------------------------------------------------
  const filesToDelete = ["concat.txt", "audio.mp3", "output.mp4", ...segFiles];
  await Promise.all(
    filesToDelete.map((f) => ff.deleteFile(f).catch(() => { /* ignore missing */ }))
  );

  return outputData.buffer as ArrayBuffer;
}
