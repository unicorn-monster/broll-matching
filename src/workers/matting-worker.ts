// src/workers/matting-worker.ts
//
// Task 11 (talking-head-overlay): browser-side background matting worker.
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
import { FilesetResolver, ImageSegmenter, type MPMask } from "@mediapipe/tasks-vision";

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
  // 1. MediaPipe selfie segmenter (GPU-backed).
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  );
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: "VIDEO",
  });

  // 2. Demux source mp4: build a VideoDecoderConfig from the moov.
  const rawBuffer = await sourceBlob.arrayBuffer();
  const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(rawBuffer, 0);
  const mp4: ISOFile = createFile();

  let totalFrames = 0;
  let width = 0;
  let height = 0;
  let trackId = 0;

  const decoderConfig = await new Promise<VideoDecoderConfig>((resolve, reject) => {
    mp4.onError = (_module, message) => reject(new Error(`mp4box: ${message}`));
    mp4.onReady = (info) => {
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
      const trak = mp4.getTrackById(track.id) as unknown as MinimalTrakBox;
      let description: Uint8Array;
      try {
        description = buildCodecDescription(trak);
      } catch (e) {
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
      mp4.setExtractionOptions(track.id, undefined, { nbSamples: 100 });
      mp4.start();
    };
    mp4.appendBuffer(mp4Buffer);
    mp4.flush();
  });

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
  encoder.configure({
    codec: "vp09.00.10.08",
    width,
    height,
    bitrate: 4_000_000,
    framerate: 30,
    alpha: "keep",
  });

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
  decoder.configure(decoderConfig);

  // 6. Pump samples → decoder until we've fed the full sample count.
  await new Promise<void>((resolve, reject) => {
    let samplesFed = 0;
    mp4.onSamples = (_id, _user, samples) => {
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
    // Ensure mp4box drains any buffered samples (we already appended the
    // entire buffer above before this Promise was constructed).
    mp4.flush();
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
  segmenter: ImageSegmenter,
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
      segmenter.segmentForVideo(canvas, frame.timestamp, (result) => {
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
