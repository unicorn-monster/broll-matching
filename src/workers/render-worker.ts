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

const FINAL_WEIGHT_MS = 500;

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
    totalWeight = sectionTotalMs + FINAL_WEIGHT_MS;
    completedWeight = 0;
    currentWeight = 0;
    emitProgress(0);

    const segmentPaths: string[] = [];

    for (let i = 0; i < timeline.length; i++) {
      const section = timeline[i];
      if (!section) continue;
      const clipCount = section.clips.length || 1;
      const perClipWeight = section.durationMs / clipCount;

      for (let j = 0; j < section.clips.length; j++) {
        const matched = section.clips[j];
        if (!matched) continue;
        const segName = `seg-${i}-${j}.mp4`;
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
            segName,
          ]);
          await ffmpeg.deleteFile(inputName);
        }

        segmentPaths.push(segName);
        completedWeight += currentWeight;
        emitProgress(0);
      }
    }

    currentWeight = FINAL_WEIGHT_MS;

    const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
    await ffmpeg.writeFile("concat.txt", concatContent);
    await ffmpeg.writeFile("audio.mp3", new Uint8Array(audioBuffer));

    await ffmpeg.exec([
      "-y",
      "-f", "concat", "-safe", "0", "-i", "concat.txt",
      "-i", "audio.mp3",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      "output.mp4",
    ]);

    completedWeight = totalWeight;
    emitProgress(1);

    const output = (await ffmpeg.readFile("output.mp4")) as Uint8Array;

    for (const seg of segmentPaths) {
      try { await ffmpeg.deleteFile(seg); } catch {}
    }
    try { await ffmpeg.deleteFile("concat.txt"); } catch {}
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
