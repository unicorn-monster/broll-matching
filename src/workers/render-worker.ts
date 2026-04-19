import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { MatchedSection } from "@/lib/auto-match";

self.onmessage = async (e: MessageEvent) => {
  const { timeline, audioBuffer, clips }: {
    timeline: MatchedSection[];
    audioBuffer: ArrayBuffer;
    clips: Record<string, ArrayBuffer>;
  } = e.data;

  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
    wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
  });

  const totalSections = timeline.length;
  const segmentPaths: string[] = [];

  for (let i = 0; i < timeline.length; i++) {
    const section = timeline[i];
    self.postMessage({ type: "progress", currentSection: i + 1, totalSections });

    for (let j = 0; j < section.clips.length; j++) {
      const matched = section.clips[j];
      const segName = `seg-${i}-${j}.mp4`;

      if (matched.isPlaceholder) {
        await ffmpeg.exec([
          "-f", "lavfi",
          "-i", `color=c=black:s=1080x1350:r=30:d=${section.durationMs / 1000}`,
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-r", "30",
          segName,
        ]);
      } else {
        const clipBuf = clips[matched.indexeddbKey];
        await ffmpeg.writeFile(`input-${i}-${j}.mp4`, new Uint8Array(clipBuf));

        await ffmpeg.exec([
          "-i", `input-${i}-${j}.mp4`,
          ...(matched.trimDurationMs ? ["-t", String(matched.trimDurationMs / 1000)] : []),
          "-vf", `setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
          "-an",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-r", "30",
          segName,
        ]);
        await ffmpeg.deleteFile(`input-${i}-${j}.mp4`);
      }

      segmentPaths.push(segName);
    }
  }

  const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
  await ffmpeg.writeFile("concat.txt", concatContent);
  await ffmpeg.writeFile("audio.mp3", new Uint8Array(audioBuffer));

  await ffmpeg.exec([
    "-f", "concat", "-safe", "0", "-i", "concat.txt",
    "-i", "audio.mp3",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-c:a", "aac",
    "-shortest",
    "output.mp4",
  ]);

  const output = await ffmpeg.readFile("output.mp4") as Uint8Array;
  self.postMessage({ type: "done", output: output.buffer }, [output.buffer]);
};
