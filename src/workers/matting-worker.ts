// src/workers/matting-worker.ts
//
// Talking-head background matting worker (Task 11).
//
// Top-of-file debug marker — fires as soon as the worker module loads.
console.log("[matting-worker] module loaded at", new Date().toISOString());
//
// Pipeline (post-refactor):
//
//   main thread:  source.mp4 ──► HTMLVideoElement (browser native decoder)
//                                            │
//                                            ▼
//                                      seek + drawImage to OffscreenCanvas
//                                            │
//                                            ▼
//                                      ImageBitmap (Transferable)
//                                            │
//                                            ▼ postMessage
//   worker:                            ImageBitmap
//                                            │
//                                            ▼
//                              MediaPipe selfie segmenter
//                                            │
//                                            ▼
//                              I420A VideoFrame (alpha = mask)
//                                            │
//                                            ▼
//                          VP9 (alpha keep) ──► webm-muxer ──► Blob
//
// The mp4box.js + WebCodecs VideoDecoder demux path was removed because
// mp4box v2.3.0 stalls on B-frame / missing-DTS mp4 layouts produced by
// CapCut/QuickTime. The browser's HTMLVideoElement decoder handles every
// mp4 the browser can play, so we delegate decode there and stream raw
// ImageBitmaps into this worker via `postMessage` transfer.

import { Muxer, ArrayBufferTarget } from "webm-muxer";

// MediaPipe is loaded dynamically at runtime (see initSegmenter) rather than
// imported statically — esbuild's bundling of @mediapipe/tasks-vision breaks
// the Emscripten WASM initialization ("ModuleFactory not set" error). At
// runtime the worker fetches the ESM bundle from
// /public/mediapipe/vision_bundle.mjs, which keeps the package's own
// module-loading invariants intact.
import type {
  FilesetResolver as FilesetResolverT,
  ImageSegmenter as ImageSegmenterT,
  MPMask,
} from "@mediapipe/tasks-vision";
type MediaPipeModule = {
  FilesetResolver: typeof FilesetResolverT;
  ImageSegmenter: typeof ImageSegmenterT;
};

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

type Inbound =
  | { type: "init"; width: number; height: number; totalFrames: number; fps: number }
  | { type: "frame"; bitmap: ImageBitmap; timestamp: number; index: number }
  | { type: "finish" }
  | { type: "abort" };

type Outbound =
  | { type: "inited" }
  | { type: "frame-ack"; index: number }
  | { type: "progress"; framesDone: number; totalFrames: number }
  | { type: "done"; mattedBlob: Blob }
  | { type: "failed"; message: string };

function post(m: Outbound) {
  (self as unknown as Worker).postMessage(m);
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let aborted = false;

interface Session {
  width: number;
  height: number;
  totalFrames: number;
  segmenter: ImageSegmenterT;
  encoder: VideoEncoder;
  muxer: Muxer<ArrayBufferTarget>;
  // Reusable canvas for drawing incoming ImageBitmaps before segmentation.
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  framesEmitted: number;
  // VideoEncoder errors are async — they arrive on the `error` callback after
  // an encode() call returns. We funnel them into this holder so handleFinish
  // can re-throw with the actual error rather than crashing on a stale state.
  errorRef: { current: unknown };
  // Serialize per-frame work behind a tail promise so segmentation + encode
  // run in arrival order even if the worker is fed frames faster than it can
  // process them. The main-thread extractor backpressures on `frame-ack` to
  // keep this queue at most one-deep, but the tail-promise pattern is cheap
  // insurance.
  processingTail: Promise<void>;
}

let session: Session | null = null;

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

self.addEventListener("message", (ev: MessageEvent<Inbound>) => {
  const msg = ev.data;
  if (aborted && msg.type !== "abort") return;
  switch (msg.type) {
    case "init":
      void handleInit(msg).catch((e: unknown) => {
        post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
      });
      break;
    case "frame":
      void handleFrame(msg);
      break;
    case "finish":
      void handleFinish().catch((e: unknown) => {
        post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
      });
      break;
    case "abort":
      aborted = true;
      break;
  }
});

// ---------------------------------------------------------------------------
// Init: load MediaPipe, build muxer + encoder, reply `inited`
// ---------------------------------------------------------------------------

async function handleInit(msg: Extract<Inbound, { type: "init" }>): Promise<void> {
  const { width, height, totalFrames, fps } = msg;
  const origin = (self as unknown as { location: { origin: string } }).location.origin;
  const mpUrl = `${origin}/mediapipe/vision_bundle.mjs`;
  const mp = (await import(mpUrl)) as unknown as MediaPipeModule;
  const { FilesetResolver, ImageSegmenter } = mp;
  const vision = await FilesetResolver.forVisionTasks(`${origin}/mediapipe/wasm`);
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

  // Probe VP9 alpha support up-front and fail fast with a clear message if the
  // browser can't encode alpha. Real Chrome on desktop ≥94 supports this; some
  // Electron-based browsers (e.g. the Claude Preview tool, older Edge variants)
  // do NOT. Without this guard, encoder.configure() succeeds but the first
  // encode() throws "Cannot call 'encode' on a closed codec" with no hint why.
  const encoderConfig: VideoEncoderConfig = {
    codec: "vp09.00.10.08",
    width,
    height,
    bitrate: 4_000_000,
    framerate: fps,
    alpha: "keep",
  };
  const support = await VideoEncoder.isConfigSupported(encoderConfig);
  if (!support.supported) {
    throw new Error(
      "Trình duyệt này không hỗ trợ encode VP9 alpha. Hãy mở app trong Chrome desktop ≥ 94 (Chrome.app trên macOS, không phải Claude Preview / Electron / Safari / Firefox).",
    );
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "V_VP9",
      width,
      height,
      alpha: true,
      frameRate: fps,
    },
    type: "webm",
  });

  // Shared holder so the encoder's error callback can mutate state that
  // handleFinish reads later. Using a ref object avoids the closure-vs-
  // session-property hazard of capturing a local `let`.
  const errorRef: { current: unknown } = { current: null };
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      errorRef.current = e;
    },
  });
  encoder.configure(encoderConfig);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");

  session = {
    width,
    height,
    totalFrames,
    segmenter,
    encoder,
    muxer,
    canvas,
    ctx,
    framesEmitted: 0,
    errorRef,
    processingTail: Promise.resolve(),
  };

  post({ type: "inited" });
}

// ---------------------------------------------------------------------------
// Per-frame: segment + encode, then ack
// ---------------------------------------------------------------------------

function handleFrame(msg: Extract<Inbound, { type: "frame" }>): void {
  const s = session;
  if (!s) {
    post({ type: "failed", message: "frame received before init" });
    return;
  }
  const { bitmap, timestamp, index } = msg;
  // Chain onto the processing tail so timestamps reach the encoder in
  // monotonic arrival order even if the main thread bursts frames.
  s.processingTail = s.processingTail.then(async () => {
    if (aborted) {
      bitmap.close();
      return;
    }
    try {
      // Draw, then release the bitmap immediately — we have the pixels on
      // canvas now and don't want to hold the GPU resource for the duration
      // of segmentation.
      s.ctx.drawImage(bitmap, 0, 0, s.width, s.height);
      bitmap.close();

      const alphaFrame = await segmentToAlphaFrame(
        s.canvas,
        s.ctx,
        s.segmenter,
        s.width,
        s.height,
        timestamp,
      );
      s.encoder.encode(alphaFrame, { keyFrame: s.framesEmitted % 30 === 0 });
      alphaFrame.close();
      s.framesEmitted++;
      if (s.framesEmitted % 30 === 0) {
        post({ type: "progress", framesDone: s.framesEmitted, totalFrames: s.totalFrames });
      }
      // Ack last — the extractor uses this to release backpressure and send
      // the next frame. Ack'ing only after encode means at most one frame
      // is queued in the worker at a time.
      post({ type: "frame-ack", index });
    } catch (e) {
      post({
        type: "failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Finish: flush + close everything, emit the matted webm Blob
// ---------------------------------------------------------------------------

async function handleFinish(): Promise<void> {
  const s = session;
  if (!s) {
    post({ type: "failed", message: "finish received before init" });
    return;
  }
  // Drain any per-frame work still queued on the tail promise — otherwise
  // the last encodes can race the muxer.finalize() call below.
  await s.processingTail;
  await s.encoder.flush();
  s.encoder.close();
  s.segmenter.close();

  const err = s.errorRef.current;
  if (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  s.muxer.finalize();
  const { buffer } = s.muxer.target;
  const mattedBlob = new Blob([buffer], { type: "video/webm" });
  session = null;
  post({ type: "done", mattedBlob });
}

// ---------------------------------------------------------------------------
// Segmentation + I420A composition
// ---------------------------------------------------------------------------

async function segmentToAlphaFrame(
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  segmenter: ImageSegmenterT,
  width: number,
  height: number,
  timestamp: number,
): Promise<VideoFrame> {
  // segmentForVideo's callback-form returns a mask whose memory is owned by
  // the C++ task and is freed once the callback returns — we copy the mask
  // out with `.slice()` before resolving so it survives past that boundary.
  const mask = await new Promise<Uint8Array>((resolve, reject) => {
    try {
      (
        segmenter as unknown as {
          segmentForVideo: (
            i: OffscreenCanvas,
            t: number,
            cb: (r: { categoryMask?: MPMask }) => void,
          ) => void;
        }
      ).segmentForVideo(canvas, timestamp, (result) => {
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
    timestamp,
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
