import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;

  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const instance = new FFmpeg();

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd";
    await instance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpeg = instance;
    return ffmpeg;
  })();

  return loadingPromise;
}

export function isLoaded(): boolean {
  return ffmpeg?.loaded ?? false;
}

export function getFFmpeg(): FFmpeg | null {
  return ffmpeg;
}
