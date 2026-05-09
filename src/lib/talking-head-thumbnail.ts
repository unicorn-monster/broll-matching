import { loadFFmpeg } from "./ffmpeg";

const cache = new Map<string, string>(); // key = `${fileFingerprint}:${sourceSeekMs}`
let currentFingerprint: string | null = null;
let inFlight: Promise<unknown> | null = null;

function fingerprintFile(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Drops every cached blob URL when the talking-head file is replaced or removed. */
function resetTalkingHeadThumbnails(file: File | null): void {
  const fp = file ? fingerprintFile(file) : null;
  if (fp === currentFingerprint) return;
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  currentFingerprint = fp;
}

/**
 * Returns a blob URL for a single video frame at `sourceSeekMs` of the given talking-head
 * file. Decodes via the shared ffmpeg.wasm singleton; cached by `(file fingerprint, sourceSeekMs)`.
 *
 * Serialised: only one extraction runs at a time. Concurrent calls await the in-flight
 * one, then either hit the cache or kick off their own extraction. This avoids ffmpeg.wasm
 * MEMFS collisions when two TH sections render simultaneously.
 */
export async function getTalkingHeadThumbnail(file: File, sourceSeekMs: number): Promise<string> {
  resetTalkingHeadThumbnails(file);
  const key = `${currentFingerprint}:${sourceSeekMs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Wait for any in-flight extraction so the shared MEMFS isn't trampled.
  while (inFlight) {
    try { await inFlight; } catch { /* ignore — next caller retries */ }
    const cached = cache.get(key);
    if (cached) return cached;
  }

  const promise = (async () => {
    const ff = await loadFFmpeg();
    const inputName = "th-input.mp4";
    const outputName = `th-${sourceSeekMs}.png`;
    const buf = new Uint8Array(await file.arrayBuffer());
    await ff.writeFile(inputName, buf);
    await ff.exec([
      "-y",
      "-ss", String(sourceSeekMs / 1000),
      "-i", inputName,
      "-frames:v", "1",
      "-f", "image2",
      outputName,
    ]);
    const png = (await ff.readFile(outputName)) as Uint8Array;
    try { await ff.deleteFile(inputName); } catch {}
    try { await ff.deleteFile(outputName); } catch {}
    const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    cache.set(key, url);
    return url;
  })();
  inFlight = promise;
  try {
    return await promise;
  } finally {
    if (inFlight === promise) inFlight = null;
  }
}
