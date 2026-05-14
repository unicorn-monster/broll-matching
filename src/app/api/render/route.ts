import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import type { MatchedSection } from "@/lib/auto-match";

export const runtime = "nodejs";
export const maxDuration = 600;
export const dynamic = "force-dynamic";

interface RenderRequest {
  timeline: MatchedSection[];
  outputWidth: number;
  outputHeight: number;
  audioDurationMs: number;
}

const FPS = 30;
const ONE_FRAME_MS = 1000 / FPS;

async function encodeBlackSegment(
  workDir: string,
  index: number,
  durationMs: number,
  outputWidth: number,
  outputHeight: number,
): Promise<string> {
  const segPath = path.join(workDir, `gap-${index}.ts`);
  await runFFmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${outputWidth}x${outputHeight}:r=${FPS}:d=${durationMs / 1000}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    segPath,
  ]);
  return segPath;
}

export async function POST(req: Request) {
  let workDir: string | null = null;
  try {
    const formData = await req.formData();
    const timelineRaw = formData.get("timeline");
    const outputWidthRaw = formData.get("outputWidth");
    const outputHeightRaw = formData.get("outputHeight");
    const audio = formData.get("audio");

    if (typeof timelineRaw !== "string" || typeof outputWidthRaw !== "string" || typeof outputHeightRaw !== "string") {
      return NextResponse.json({ error: "Missing required fields: timeline, outputWidth, outputHeight" }, { status: 400 });
    }
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }

    const parsed = JSON.parse(timelineRaw) as RenderRequest["timeline"];
    const outputWidth = Number(outputWidthRaw);
    const outputHeight = Number(outputHeightRaw);
    if (!Number.isFinite(outputWidth) || !Number.isFinite(outputHeight) || outputWidth <= 0 || outputHeight <= 0) {
      return NextResponse.json({ error: "Invalid output dimensions" }, { status: 400 });
    }

    const audioDurationMsRaw = formData.get("audioDurationMs");
    if (typeof audioDurationMsRaw !== "string") {
      return NextResponse.json({ error: "Missing audioDurationMs" }, { status: 400 });
    }
    const audioDurationMs = Number(audioDurationMsRaw);
    if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
      return NextResponse.json({ error: "Invalid audioDurationMs" }, { status: 400 });
    }

    // Build a fileId → temp path map by writing every uploaded clip to disk under workDir.
    // Frontend appends each clip as a File whose `name` is the fileId — that lets us look
    // up the right disk path when iterating timeline entries below.
    workDir = await mkdtemp(path.join(tmpdir(), "vsl-render-"));
    const clipsByFileId = new Map<string, string>();
    for (const entry of formData.getAll("clips")) {
      if (!(entry instanceof File)) continue;
      const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const p = path.join(workDir, `clip-${safeName}.mp4`);
      await writeFile(p, Buffer.from(await entry.arrayBuffer()));
      clipsByFileId.set(entry.name, p);
    }
    const audioPath = path.join(workDir, "audio.mp3");
    await writeFile(audioPath, Buffer.from(await audio.arrayBuffer()));

    // Captions (optional): PNG files in `captions` field + metadata JSON in `captionsMetadata`.
    // Each PNG is a tightly-cropped overlay image; metadata carries its absolute (x, y) pixel
    // offset inside the output video and the [startMs, endMs) visibility window.
    interface CaptionMeta {
      index: number;
      startMs: number;
      endMs: number;
      xPx: number;
      yPx: number;
    }
    const captionMetaRaw = formData.get("captionsMetadata");
    let captionMeta: CaptionMeta[] = [];
    if (typeof captionMetaRaw === "string") {
      try {
        const parsed = JSON.parse(captionMetaRaw) as unknown;
        if (Array.isArray(parsed)) captionMeta = parsed as CaptionMeta[];
      } catch {
        return NextResponse.json({ error: "Invalid captionsMetadata JSON" }, { status: 400 });
      }
    }
    const captionPaths: string[] = [];
    const captionEntries = formData.getAll("captions");
    for (let i = 0; i < captionEntries.length; i++) {
      const entry = captionEntries[i];
      if (!(entry instanceof File)) continue;
      const dest = path.join(workDir, `caption-${i}.png`);
      const buf = Buffer.from(await entry.arrayBuffer());
      await writeFile(dest, buf);
      captionPaths.push(dest);
    }
    if (captionPaths.length !== captionMeta.length) {
      return NextResponse.json({
        error: `captions count mismatch: ${captionPaths.length} files vs ${captionMeta.length} metadata entries`,
      }, { status: 400 });
    }

    // Encode each timeline entry into an MPEG-TS segment. MPEG-TS is the standard
    // intermediate for `-c copy` concatenation — every segment shares identical codec
    // params (libx264 yuv420p 30fps), so the final concat does not re-encode.
    // Sort defensively by absolute start, then walk through filling gaps with black.
    const sortedTimeline = [...parsed].sort((a, b) => a.startMs - b.startMs);

    const segments: string[] = [];
    let cursor = 0;
    let gapIndex = 0;

    for (let i = 0; i < sortedTimeline.length; i++) {
      const section = sortedTimeline[i];
      if (!section || section.durationMs === 0) continue;

      // Leading gap before this section.
      const gapBefore = section.startMs - cursor;
      if (gapBefore >= ONE_FRAME_MS) {
        segments.push(await encodeBlackSegment(workDir, gapIndex++, gapBefore, outputWidth, outputHeight));
      }

      // Section's clip(s) — same encode logic as before.
      for (let j = 0; j < section.clips.length; j++) {
        const matched = section.clips[j];
        if (!matched) continue;
        const segPath = path.join(workDir, `seg-${i}-${j}.ts`);
        const sectionSec = section.durationMs / 1000;

        if (matched.sourceSeekMs !== undefined) {
          // Talking-head slice: seek to sourceSeekMs inside the source MP4 before
          // opening the input so ffmpeg discards frames before the seek point.
          // PTS is reset to zero after the seek via setpts=PTS-STARTPTS, which
          // prevents timestamp discontinuities in the MPEG-TS segment.
          const inputPath = clipsByFileId.get(matched.fileId);
          if (!inputPath) continue;
          await runFFmpeg([
            "-y",
            "-ss", String(matched.sourceSeekMs / 1000),  // input seek (accurate by default in ffmpeg ≥ 2.1)
            "-i", inputPath,
            "-t", String((matched.trimDurationMs ?? section.durationMs) / 1000),
            "-vf",
              `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,` +
              `pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2,` +
              `setpts=PTS-STARTPTS`,
            "-an",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "fastdecode",
            "-pix_fmt", "yuv420p",
            "-r", String(FPS),
            "-f", "mpegts",
            segPath,
          ]);
        } else if (matched.isPlaceholder) {
          await runFFmpeg([
            "-y",
            "-f", "lavfi",
            "-i", `color=c=black:s=${outputWidth}x${outputHeight}:r=${FPS}:d=${sectionSec}`,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "fastdecode",
            "-pix_fmt", "yuv420p",
            "-r", String(FPS),
            "-f", "mpegts",
            segPath,
          ]);
        } else {
          const inputPath = clipsByFileId.get(matched.fileId);
          if (!inputPath) continue;
          await runFFmpeg([
            "-y",
            "-i", inputPath,
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
            "-r", String(FPS),
            "-f", "mpegts",
            segPath,
          ]);
        }
        segments.push(segPath);
      }

      cursor = section.endMs;
    }

    // Trailing gap to fill out the audio length.
    const trailing = audioDurationMs - cursor;
    if (trailing >= ONE_FRAME_MS) {
      segments.push(await encodeBlackSegment(workDir, gapIndex++, trailing, outputWidth, outputHeight));
    }

    if (segments.length === 0) {
      // Audio with no script content at all → encode one full-length black segment.
      segments.push(await encodeBlackSegment(workDir, 0, audioDurationMs, outputWidth, outputHeight));
    }

    // Single-pass concat + audio mux. Native ffmpeg has no MEMFS-style cap, so a flat
    // 133-input concat is fine — no need for the binary-tree workaround the WASM build
    // required.
    const concatListPath = path.join(workDir, "list.txt");
    await writeFile(concatListPath, segments.map((p) => `file '${p}'`).join("\n"));
    const outputPath = path.join(workDir, "output.mp4");

    if (captionPaths.length === 0) {
      // Fast path — no captions, zero re-encode for video (concat demuxer + stream copy).
      await runFFmpeg([
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatListPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        outputPath,
      ]);
    } else {
      // Captions present — chain `overlay` filters with `enable='between(t,a,b)'` so each
      // caption is visible only inside its time window. This requires re-encoding video
      // (filter graph cannot run with `-c:v copy`), so we re-encode with veryfast/yuv420p
      // for browser compatibility while keeping audio as a straight AAC mux.
      const captionInputs: string[] = [];
      for (const p of captionPaths) captionInputs.push("-i", p);

      const filterParts: string[] = [];
      let prev = "0:v";
      for (let i = 0; i < captionMeta.length; i++) {
        const m = captionMeta[i]!;
        const next = i === captionMeta.length - 1 ? "vout" : `v${i + 1}`;
        // Input indexes: 0=concat (video-only), 1=audio, captions start at 2.
        const inputIdx = i + 2;
        const startSec = (m.startMs / 1000).toFixed(3);
        const endSec = (m.endMs / 1000).toFixed(3);
        filterParts.push(
          `[${prev}][${inputIdx}:v]overlay=${m.xPx}:${m.yPx}:enable='between(t,${startSec},${endSec})'[${next}]`,
        );
        prev = next;
      }

      await runFFmpeg([
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatListPath,
        "-i", audioPath,
        ...captionInputs,
        "-filter_complex", filterParts.join(";"),
        "-map", "[vout]",
        "-map", "1:a",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-r", String(FPS),
        "-c:a", "aac",
        "-shortest",
        outputPath,
      ]);
    }

    const buf = await readFile(outputPath);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="vsl-${Date.now()}.mp4"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/render]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) {
      void rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1000)}`));
    });
  });
}
