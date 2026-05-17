// src/workers/matting-worker.ts
//
// Task 11 (talking-head-overlay): browser-side background matting worker.

// Top-of-file debug marker — fires as soon as the worker module loads.
console.log("[matting-worker] module loaded at", new Date().toISOString());
//
// Pipeline:  source.mp4 (Blob) ──► MP4Box demux ──► VideoDecoder ──► VideoFrame
//                                                                       │
//                                                                       ▼
//                                                       MediaPipe selfie segmenter
//                                                                       │
//                                                                       ▼
//                                                        I420A VideoFrame (alpha = mask)
//                                                                       │
//                                                                       ▼
//                                                  VP9 (alpha keep) ──► webm-muxer ──► Blob
//
// Notes on deviations from the plan template:
//   * `MP4ArrayBuffer` does not exist in mp4box's typings — we use the
//     concrete `MP4BoxBuffer` class plus `MP4BoxBuffer.fromArrayBuffer(...)`.
//   * mp4box now ships first-class types, so we import the named symbols
//     (`createFile`, `MP4BoxBuffer`, `DataStream`, `Endianness`, `trakBox`,
//     `avcCBox`, `hvcCBox`) rather than reaching into a `globalThis as any`.
//   * The MediaPipe `MPMask` lifetime is owned by the C++ task and is freed
//     once the callback returns. We `.slice()` the Uint8Array out of the
//     mask before resolving the promise so the data stays valid past the
//     callback boundary.
//   * `noUncheckedIndexedAccess` is on in `tsconfig.json`, so we always
//     dereference samples via explicit local bindings rather than `samples[i]!`
//     chains.

import { Muxer, ArrayBufferTarget } from "webm-muxer";
import {
  createFile,
  MP4BoxBuffer,
  DataStream,
  Endianness,
  type ISOFile,
  type VisualSampleEntry,
} from "mp4box";

// The internal mp4box class types (`trakBox`, `avcCBox`, `hvcCBox`,
// `stblBox`, ...) aren't re-exported from the package entrypoint, only
// declared internally. We describe just the structural shape we touch.
//
// `box.write(stream)` accepts a DataStream and appends the *full* box
// (including its 8-byte size+fourcc header) — that's all `buildCodecDescription`
// needs to know about it.
interface CodecConfigBox {
  write(stream: DataStream): void;
}
interface MinimalTrakBox {
  mdia: { minf: { stbl: { stsd: { entries: ReadonlyArray<VisualSampleEntry> } } } };
}
// MediaPipe is loaded dynamically at runtime (see runMatting) rather than imported
// statically — esbuild's bundling of @mediapipe/tasks-vision breaks the Emscripten
// WASM initialization ("ModuleFactory not set" error). At runtime the worker fetches
// the ESM bundle from /public/mediapipe/vision_bundle.mjs, which keeps the package's
// own module-loading invariants intact.
import type { FilesetResolver as FilesetResolverT, ImageSegmenter as ImageSegmenterT, MPMask } from "@mediapipe/tasks-vision";
type MediaPipeModule = {
  FilesetResolver: typeof FilesetResolverT;
  ImageSegmenter: typeof ImageSegmenterT;
};

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

type Inbound =
  | { type: "start"; sourceBlob: Blob; mattedFileId: string }
  | { type: "abort" };

type Outbound =
  | { type: "progress"; framesDone: number; totalFrames: number }
  | { type: "done"; mattedBlob: Blob }
  | { type: "failed"; message: string };

let aborted = false;

// Debug helper that emits progress sentinels with a `debug` label. Useful during dev;
// kept as a no-op in production by setting DEBUG_WORKER=false at build time.
const DEBUG_WORKER = false;
function debug(step: string, extra?: Record<string, unknown>) {
  if (!DEBUG_WORKER) return;
  (self as unknown as Worker).postMessage({ type: "progress", framesDone: -1, totalFrames: -1, debug: step, ...extra });
}

self.addEventListener("message", async (ev: MessageEvent<Inbound>) => {
  const msg = ev.data;
  if (msg.type === "abort") {
    aborted = true;
    return;
  }
  if (msg.type !== "start") return;
  try {
    const blob = await runMatting(msg.sourceBlob);
    if (!aborted) post({ type: "done", mattedBlob: blob });
  } catch (e: unknown) {
    debug("caught-error", { err: e instanceof Error ? e.message : String(e) });
    post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
  }
});

function post(m: Outbound) {
  (self as unknown as Worker).postMessage(m);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function runMatting(sourceBlob: Blob): Promise<Blob> {
  debug("runMatting-start", { sizeMB: (sourceBlob.size / 1024 / 1024) | 0 });
  const origin = (self as unknown as { location: { origin: string } }).location.origin;
  debug("origin-resolved", { origin });
  const mpUrl = `${origin}/mediapipe/vision_bundle.mjs`;
  debug("before-mp-import", { mpUrl });
  const mp = (await import(mpUrl)) as unknown as MediaPipeModule;
  debug("after-mp-import", { keys: Object.keys(mp).slice(0, 5) });
  const { FilesetResolver, ImageSegmenter } = mp;
  debug("before-fileset-resolver");
  const vision = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`);
  debug("after-fileset-resolver");
  debug("before-segmenter-create");
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      // Local model — googleapis CDN can hang in some networks.
      modelAssetPath: `${origin}/mediapipe/selfie_segmenter.tflite`,
      delegate: "GPU",
    },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: "VIDEO",
  });
  debug("after-segmenter-create");

  // 2. Demux source mp4: build a VideoDecoderConfig from the moov.
  debug("before-blob-arraybuffer");
  const rawBuffer = await sourceBlob.arrayBuffer();
  debug("after-blob-arraybuffer", { bytes: rawBuffer.byteLength });
  const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(rawBuffer, 0);
  debug("after-mp4buffer-wrap");
  const mp4: ISOFile = createFile();
  debug("after-createFile");

  let totalFrames = 0;
  let width = 0;
  let height = 0;
  let trackId = 0;

  // Sample callback must be registered BEFORE mp4.start() — mp4box doesn't buffer
  // samples for callbacks that don't yet exist. We capture a Deferred and resolve
  // it from inside onSamples below.
  let onSamplesCb: ((samples: ReadonlyArray<{ data: ArrayBuffer | null; cts: number; duration: number; timescale: number; is_sync: boolean; number: number }>) => void) | null = null;
  let placeholderCalls = 0;
  mp4.onSamples = (_id, _user, samples) => {
    placeholderCalls++;
    if (placeholderCalls === 1) debug("placeholder-onSamples-FIRST", { samples: samples.length, hasCb: !!onSamplesCb });
    else if (placeholderCalls % 5 === 0) debug("placeholder-onSamples-batch", { call: placeholderCalls, samples: samples.length, hasCb: !!onSamplesCb });
    if (onSamplesCb) onSamplesCb(samples as unknown as Parameters<NonNullable<typeof onSamplesCb>>[0]);
  };

  const decoderConfig = await new Promise<VideoDecoderConfig>((resolve, reject) => {
    mp4.onError = (_module, message) => {
      debug("mp4-onError", { message });
      reject(new Error(`mp4box: ${message}`));
    };
    mp4.onReady = (info) => {
      debug("mp4-onReady", { trackCount: info.videoTracks.length });
      const track = info.videoTracks[0];
      if (!track) {
        reject(new Error("No video track in source mp4"));
        return;
      }
      if (!track.video) {
        reject(new Error("Source mp4 video track missing dimensions"));
        return;
      }
      totalFrames = track.nb_samples;
      width = track.video.width;
      height = track.video.height;
      trackId = track.id;
      console.log("[matting] track info:", { id: track.id, codec: track.codec, width, height, totalFrames });
      const trak = mp4.getTrackById(track.id) as unknown as MinimalTrakBox;
      let description: Uint8Array;
      try {
        description = buildCodecDescription(trak);
        console.log("[matting] codec description built, length:", description.length);
      } catch (e) {
        console.error("[matting] buildCodecDescription failed:", e);
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      resolve({
        codec: track.codec,
        codedWidth: width,
        codedHeight: height,
        description,
      });
      // Request samples now that onReady has resolved the codec config.
      // NOTE: we do NOT call setExtractionOptions + start() here. Sample extraction
      // is deferred until the real onSamples handler is registered in the next phase —
      // otherwise the first batches fire before the handler exists and are dropped.
    };
    debug("before-mp4.appendBuffer");
    mp4.appendBuffer(mp4Buffer);
    debug("after-mp4.appendBuffer");
    mp4.flush();
    debug("after-mp4.flush");
  });
  console.log("[matting] decoderConfig resolved:", decoderConfig.codec);

  debug("before-muxer-create", { width, height });
  // 3. WebM muxer with VP9-alpha video track.
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "V_VP9",
      width,
      height,
      alpha: true,
      frameRate: 30,
    },
    type: "webm",
  });

  // 4. VideoEncoder — VP9 with alpha kept.
  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  debug("before-encoder-configure");
  encoder.configure({
    codec: "vp09.00.10.08",
    width,
    height,
    bitrate: 4_000_000,
    framerate: 30,
    alpha: "keep",
  });
  debug("after-encoder-configure");

  // 5. VideoDecoder — feeds raw frames into the segmenter, then re-encodes
  // the I420A composite. We serialize per-frame work behind a tail promise to
  // guarantee timestamp ordering reaches the encoder monotonically (B-frame
  // safe — VideoDecoder presents frames in display order already).
  let framesEmitted = 0;
  let decoderError: unknown = null;
  let processingTail: Promise<void> = Promise.resolve();

  const decoder = new VideoDecoder({
    output: (frame) => {
      processingTail = processingTail.then(async () => {
        if (aborted) {
          frame.close();
          return;
        }
        try {
          const alphaFrame = await segmentToAlphaFrame(frame, segmenter, width, height);
          encoder.encode(alphaFrame, { keyFrame: framesEmitted % 30 === 0 });
          alphaFrame.close();
          framesEmitted++;
          if (framesEmitted % 30 === 0) {
            post({ type: "progress", framesDone: framesEmitted, totalFrames });
          }
        } finally {
          frame.close();
        }
      });
    },
    error: (e) => {
      decoderError = e;
    },
  });
  debug("before-decoder-configure");
  decoder.configure(decoderConfig);
  debug("after-decoder-configure");

  debug("entering-sample-pump-promise", { totalFrames });
  // 6. Pump samples → decoder until we've fed the full sample count.
  await new Promise<void>((resolve, reject) => {
    let samplesFed = 0;
    let batchCount = 0;
    onSamplesCb = (samples) => {
      batchCount++;
      if (batchCount === 1) debug("first-onSamples-batch", { samples: samples.length });
      else if (batchCount % 10 === 0) debug("onSamples-batch", { batchCount, samplesFed });
      for (const s of samples) {
        if (aborted) break;
        const data = s.data;
        if (!data) continue;
        decoder.decode(
          new EncodedVideoChunk({
            type: s.is_sync ? "key" : "delta",
            timestamp: (s.cts * 1_000_000) / s.timescale,
            duration: (s.duration * 1_000_000) / s.timescale,
            data,
          }),
        );
        samplesFed++;
      }
      if (decoderError) {
        reject(decoderError instanceof Error ? decoderError : new Error(String(decoderError)));
        return;
      }
      // We requested every frame — resolve once we've fed them all.
      if (totalFrames > 0 && samplesFed >= totalFrames) resolve();
    };
    // Some files may have zero-frame edge cases; bail out via the failsafe below.
    if (totalFrames === 0) {
      reject(new Error("Source mp4 reports zero video samples"));
    }
    // Now that onSamplesCb is bound, kick off extraction. mp4box will fire
    // onSamples in batches of `nbSamples`.
    debug("calling-setExtractionOptions+start", { trackId });
    // Try without options to use mp4box defaults
    mp4.setExtractionOptions(trackId);
    mp4.start();
    debug("called-start");
    // Reference trackId so the linter knows we deliberately captured it for
    // future extractionOptions calls if we ever stream rather than batch-load.
    void trackId;
  });

  await decoder.flush();
  // Drain any per-frame work still queued behind the tail promise before
  // flushing the encoder — otherwise the last batch of encodes may race the
  // finalize() call below.
  await processingTail;
  await encoder.flush();
  encoder.close();
  decoder.close();
  segmenter.close();

  if (encoderError) {
    throw encoderError instanceof Error ? encoderError : new Error(String(encoderError));
  }
  if (decoderError) {
    throw decoderError instanceof Error ? decoderError : new Error(String(decoderError));
  }

  muxer.finalize();
  const { buffer } = muxer.target;
  return new Blob([buffer], { type: "video/webm" });
}

// ---------------------------------------------------------------------------
// Codec config builder — extracts the avcC / hvcC config record from the
// first sample entry of the video track and serialises it (without the 8-byte
// box header) to feed VideoDecoder.configure({ description }).
// ---------------------------------------------------------------------------

function buildCodecDescription(trak: MinimalTrakBox): Uint8Array {
  const stsd = trak.mdia.minf.stbl.stsd;
  const entry = stsd.entries[0];
  if (!entry) {
    throw new Error("Source mp4 has no sample description entry");
  }
  // The avcC / hvcC boxes live on the avc*/hvc*SampleEntryBase subclasses;
  // VisualSampleEntry itself doesn't expose them, so we narrow structurally.
  const codecEntry = entry as VisualSampleEntry & {
    avcC?: CodecConfigBox;
    hvcC?: CodecConfigBox;
  };
  const box = codecEntry.avcC ?? codecEntry.hvcC;
  if (!box) {
    throw new Error(
      "Unsupported codec — only AVC (H.264) and HEVC (H.265) mp4 sources are supported",
    );
  }
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  // box.write() emits the full box including the 8-byte size+fourcc header.
  // VideoDecoder.configure() expects just the configuration record payload,
  // so we slice the header off.
  return new Uint8Array(stream.buffer, 8);
}

// ---------------------------------------------------------------------------
// Segmentation + I420A composition
// ---------------------------------------------------------------------------

async function segmentToAlphaFrame(
  frame: VideoFrame,
  segmenter: ImageSegmenterT,
  width: number,
  height: number,
): Promise<VideoFrame> {
  // Draw the decoded frame onto an OffscreenCanvas so we can both run the
  // segmenter on it AND read back RGBA pixels for the YUV conversion.
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }
  ctx.drawImage(frame, 0, 0);

  // segmentForVideo's callback-form returns the mask whose memory is owned by
  // the C++ task and is freed once the callback returns — we copy the mask
  // out with `.slice()` before resolving so it survives past that boundary.
  const mask = await new Promise<Uint8Array>((resolve, reject) => {
    try {
      (segmenter as unknown as { segmentForVideo: (i: OffscreenCanvas, t: number, cb: (r: { categoryMask?: MPMask }) => void) => void }).segmentForVideo(canvas, frame.timestamp, (result) => {
        const cm: MPMask | undefined = result.categoryMask;
        if (!cm) {
          reject(new Error("Segmenter returned no categoryMask"));
          return;
        }
        const copy = cm.getAsUint8Array().slice();
        cm.close();
        resolve(copy);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const ySize = width * height;
  const uvW = width >> 1;
  const uvH = height >> 1;
  const uvSize = uvW * uvH;

  // Single contiguous buffer laid out Y | U | V | A — matches the `layout`
  // strides + offsets we hand to VideoFrame below.
  const buf = new Uint8Array(ySize + 2 * uvSize + ySize);
  const yPlane = buf.subarray(0, ySize);
  const uPlane = buf.subarray(ySize, ySize + uvSize);
  const vPlane = buf.subarray(ySize + uvSize, ySize + 2 * uvSize);
  const aPlane = buf.subarray(ySize + 2 * uvSize);
  rgbaToI420A(rgba, mask, width, height, yPlane, uPlane, vPlane, aPlane);

  const init: VideoFrameBufferInit = {
    format: "I420A",
    codedWidth: width,
    codedHeight: height,
    timestamp: frame.timestamp,
    layout: [
      { offset: 0, stride: width },
      { offset: ySize, stride: uvW },
      { offset: ySize + uvSize, stride: uvW },
      { offset: ySize + 2 * uvSize, stride: width },
    ],
  };
  return new VideoFrame(buf, init);
}

// ---------------------------------------------------------------------------
// BT.601 RGB → YUV (limited range) + alpha = mask.
// MediaPipe's selfie_segmenter category mask: 0 = foreground (person),
// non-zero = background. We invert that so alpha=255 keeps the person.
// ---------------------------------------------------------------------------

function rgbaToI420A(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  y: Uint8Array,
  u: Uint8Array,
  v: Uint8Array,
  a: Uint8Array,
): void {
  // Luma + alpha pass (full-resolution).
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i;
      const px = idx * 4;
      const r = rgba[px] ?? 0;
      const g = rgba[px + 1] ?? 0;
      const b = rgba[px + 2] ?? 0;
      y[idx] = (0.257 * r + 0.504 * g + 0.098 * b + 16) | 0;
      // MediaPipe selfie: category 0 = person foreground. Invert: person → 255.
      a[idx] = (mask[idx] ?? 255) === 0 ? 255 : 0;
    }
  }
  // Chroma pass at 2x2 subsampling.
  const uvW = W >> 1;
  for (let j = 0; j < H; j += 2) {
    for (let i = 0; i < W; i += 2) {
      const px = (j * W + i) * 4;
      const r = rgba[px] ?? 0;
      const g = rgba[px + 1] ?? 0;
      const b = rgba[px + 2] ?? 0;
      const uvIdx = (j >> 1) * uvW + (i >> 1);
      u[uvIdx] = (-0.148 * r - 0.291 * g + 0.439 * b + 128) | 0;
      v[uvIdx] = (0.439 * r - 0.368 * g - 0.071 * b + 128) | 0;
    }
  }
}
