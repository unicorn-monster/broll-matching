import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { MatchedSection } from "@/lib/auto-match";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;
let announcedLoaded = false;
let ffmpegBaseURL = "";

let totalWeight = 0;
let completedWeight = 0;
let currentWeight = 0;

function emitProgress(subProgress: number) {
  if (totalWeight <= 0) return;
  const clamped = Math.max(0, Math.min(1, subProgress));
  const overall = Math.min(1, (completedWeight + clamped * currentWeight) / totalWeight);
  self.postMessage({ type: "progress", overall });
}

function ensureLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  const instance = new FFmpeg();
  instance.on("progress", ({ progress }) => emitProgress(progress));
  instance.on("log", ({ message }) => self.postMessage({ type: "log", message }));
  loadPromise = (async () => {
    if (!ffmpegBaseURL) {
      throw new Error("ffmpegBaseURL not set — main thread must send {cmd:'load', baseURL} first");
    }
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${ffmpegBaseURL}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${ffmpegBaseURL}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await instance.load({ coreURL, wasmURL });
    ffmpeg = instance;
    if (!announcedLoaded) {
      announcedLoaded = true;
      self.postMessage({ type: "loaded" });
    }
  })().catch((err: unknown) => {
    loadPromise = null;
    ffmpeg = null;
    self.postMessage({
      type: "load-error",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  });
  return loadPromise;
}

const FINAL_MUX_WEIGHT_MS = 500;
/** Per pair-concat operation in the tree, in "ms" units for the progress weighting.
 *  Concat with -c copy is fast (mostly I/O), so each op contributes a small fixed weight. */
const CONCAT_OP_WEIGHT_MS = 80;

/**
 * Reduces a list of in-memory MPEG-TS segment buffers into a single concatenated buffer
 * via a binary tree of pair-wise concats with `-c copy`. The bytes live on the worker's
 * JS heap (Uint8Array[]) between waves; only the 2 inputs + 1 output for each individual
 * concat op ever sit in MEMFS at the same time. This bounds WASM linear memory usage
 * to roughly the size of a single pair-merge regardless of total segment count.
 *
 * Quality is preserved exactly: `-c copy` rewrites only container packets, never
 * touching the encoded H.264 NALUs. MPEG-TS is used as the intermediate format because
 * it is designed for stream concatenation under copy.
 */
async function streamingPairwiseConcat(
  ffmpeg: FFmpeg,
  inputs: Uint8Array[],
  onOpDone: () => void,
): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error("streamingPairwiseConcat: no inputs");
  if (inputs.length === 1) return inputs[0]!;

  let queue = inputs;
  let wave = 0;

  while (queue.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < queue.length; i += 2) {
      const aPath = `cat-w${wave}-p${i / 2}-a.ts`;
      const bPath = `cat-w${wave}-p${i / 2}-b.ts`;
      const outPath = `cat-w${wave}-p${i / 2}-m.ts`;
      const listPath = `cat-w${wave}-p${i / 2}-l.txt`;

      // writeFile detaches the input ArrayBuffer; that's fine since each segment buffer
      // is consumed exactly once on its way through the tree.
      await ffmpeg.writeFile(aPath, queue[i]!);
      await ffmpeg.writeFile(bPath, queue[i + 1]!);
      await ffmpeg.writeFile(listPath, `file '${aPath}'\nfile '${bPath}'\n`);
      await ffmpeg.exec([
        "-y",
        "-f", "concat", "-safe", "0", "-i", listPath,
        "-c", "copy",
        outPath,
      ]);
      const merged = (await ffmpeg.readFile(outPath)) as Uint8Array;
      try { await ffmpeg.deleteFile(aPath); } catch {}
      try { await ffmpeg.deleteFile(bPath); } catch {}
      try { await ffmpeg.deleteFile(outPath); } catch {}
      try { await ffmpeg.deleteFile(listPath); } catch {}
      next.push(merged);
      onOpDone();
    }
    if (queue.length % 2 === 1) next.push(queue[queue.length - 1]!);
    queue = next;
    wave++;
  }

  return queue[0]!;
}

/** Counts the total number of pair-concat operations a tree of size N will perform. */
function countConcatOps(n: number): number {
  let total = 0;
  let cur = n;
  while (cur > 1) {
    const ops = Math.floor(cur / 2);
    total += ops;
    cur = ops + (cur % 2);
  }
  return total;
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data;

  if (data.cmd === "load") {
    if (typeof data.baseURL === "string") ffmpegBaseURL = data.baseURL;
    self.postMessage({ type: "stage", stage: "loading" });
    try {
      await ensureLoaded();
    } catch {
      // already reported via load-error
    }
    return;
  }

  if (data.cmd !== "render") return;

  const { timeline, audioBuffer, clips, outputWidth, outputHeight } = data as {
    timeline: MatchedSection[];
    audioBuffer: ArrayBuffer;
    clips: Record<string, ArrayBuffer>;
    outputWidth: number;
    outputHeight: number;
  };

  try {
    await ensureLoaded();
    if (!ffmpeg) return;

    self.postMessage({ type: "stage", stage: "rendering" });

    const sectionTotalMs = timeline.reduce((sum, s) => sum + s.durationMs, 0);
    const totalClipCount = timeline.reduce((sum, s) => sum + s.clips.length, 0);
    const concatOpCount = countConcatOps(totalClipCount);
    const concatPhaseWeight = concatOpCount * CONCAT_OP_WEIGHT_MS;
    totalWeight = sectionTotalMs + concatPhaseWeight + FINAL_MUX_WEIGHT_MS;
    completedWeight = 0;
    currentWeight = 0;
    emitProgress(0);

    // Hold finished segments on the worker's JS heap, not in MEMFS. After encoding each
    // segment we immediately read its bytes out and delete the file, so MEMFS never
    // accumulates more than one in-flight segment at a time. JS heap (multi-GB) easily
    // handles the total bytes; WASM linear memory (~1 GB practical cap) does not.
    const segmentBuffers: Uint8Array[] = [];

    for (let i = 0; i < timeline.length; i++) {
      const section = timeline[i];
      if (!section) continue;
      const clipCount = section.clips.length || 1;
      const perClipWeight = section.durationMs / clipCount;

      for (let j = 0; j < section.clips.length; j++) {
        const matched = section.clips[j];
        if (!matched) continue;
        const segName = `seg-${i}-${j}.ts`;
        currentWeight = perClipWeight;

        if (matched.isPlaceholder) {
          await ffmpeg.exec([
            "-y",
            "-f", "lavfi",
            "-i", `color=c=black:s=${outputWidth}x${outputHeight}:r=30:d=${section.durationMs / 1000}`,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "fastdecode",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            "-f", "mpegts",
            segName,
          ]);
        } else {
          const clipBuf = clips[matched.fileId];
          if (!clipBuf) continue;
          const inputName = `input-${i}-${j}.mp4`;
          // Copy: ffmpeg.writeFile transfers (detaches) the buffer to its internal
          // worker. Same fileId appears in multiple timeline entries, so the
          // cached clipBuf must survive for the next iteration.
          await ffmpeg.writeFile(inputName, new Uint8Array(clipBuf).slice());

          await ffmpeg.exec([
            "-y",
            "-i", inputName,
            ...(matched.trimDurationMs ? ["-t", String(matched.trimDurationMs / 1000)] : []),
            "-vf",
            `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
            `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2,` +
            `setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
            "-an",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "fastdecode",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            "-f", "mpegts",
            segName,
          ]);
          await ffmpeg.deleteFile(inputName);
        }

        // Offload to worker heap and free MEMFS — this is what bounds WASM memory growth.
        const segBytes = (await ffmpeg.readFile(segName)) as Uint8Array;
        await ffmpeg.deleteFile(segName);
        segmentBuffers.push(segBytes);

        completedWeight += currentWeight;
        emitProgress(0);
      }
    }

    // Streaming pair-wise reduce: bytes live on JS heap between waves; only 2 inputs +
    // 1 output of any single concat op ever exist in MEMFS at the same time.
    currentWeight = CONCAT_OP_WEIGHT_MS;
    const finalTsBytes = await streamingPairwiseConcat(ffmpeg, segmentBuffers, () => {
      completedWeight += CONCAT_OP_WEIGHT_MS;
      emitProgress(0);
    });
    segmentBuffers.length = 0;

    // Final mux: combine the single concatenated .ts video stream with audio into mp4.
    // -c:v copy ensures zero re-encode (resolution + quality preserved exactly).
    currentWeight = FINAL_MUX_WEIGHT_MS;
    await ffmpeg.writeFile("final.ts", finalTsBytes);
    await ffmpeg.writeFile("audio.mp3", new Uint8Array(audioBuffer));
    await ffmpeg.exec([
      "-y",
      "-i", "final.ts",
      "-i", "audio.mp3",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      "output.mp4",
    ]);
    try { await ffmpeg.deleteFile("final.ts"); } catch {}

    completedWeight = totalWeight;
    emitProgress(1);

    const output = (await ffmpeg.readFile("output.mp4")) as Uint8Array;

    try { await ffmpeg.deleteFile("audio.mp3"); } catch {}
    try { await ffmpeg.deleteFile("output.mp4"); } catch {}

    self.postMessage({ type: "done", output: output.buffer }, { transfer: [output.buffer] });
  } catch (err: unknown) {
    self.postMessage({
      type: "render-error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
