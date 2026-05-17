// src/lib/matting/frame-extractor.ts
//
// Main-thread frame extractor for the talking-head matting pipeline.
//
// Why this lives on the main thread (not in the worker):
//   The prior pipeline demuxed mp4 via mp4box.js inside the worker. mp4box v2.3.0
//   cannot deliver `onSamples` callbacks for mp4s with the B-frame + missing-DTS
//   layout commonly produced by CapCut/QuickTime — `start()` returns but no
//   samples ever arrive. Pivoting to HTMLVideoElement gives us the browser's
//   native decoder, which handles every mp4 the browser can play (same stack
//   CapCut relies on).
//
// The extractor:
//   1. Creates a hidden <video>, seeks frame-by-frame at the canonical 30 fps
//      (matches the render pipeline's FPS constant).
//   2. Paints each frame onto an OffscreenCanvas and transfers an ImageBitmap
//      to the worker (zero-copy GPU handoff).
//   3. Backpressures on the worker's `frame-ack` message so we never queue
//      more than one in-flight frame.
//
// The caller owns the Worker — we only pump messages through it.

import { FPS } from "@/lib/render-segments";

export interface FrameExtractorMeta {
  width: number;
  height: number;
  totalFrames: number;
  fps: number;
}

export interface FrameExtractorEvents {
  /** Fired once after the video metadata has loaded, before any frame is sent. */
  onMeta?: (info: FrameExtractorMeta) => void;
  /** Fired after each frame has been ack'd by the worker — drives progress UI. */
  onFrame?: (index: number) => void;
  /** Fired after the `finish` message has been posted to the worker. */
  onDone?: () => void;
  /** Fired on any unrecoverable error inside the extractor. */
  onError?: (err: Error) => void;
}

export interface FrameExtractor {
  /** Cancel extraction, revoke the object URL, and detach event listeners. */
  abort: () => void;
}

// Worker → main inbound messages this extractor cares about. Other worker
// messages (`progress`, `done`, `failed`) are owned by the caller.
type WorkerInbound =
  | { type: "inited" }
  | { type: "frame-ack"; index: number }
  | { type: "failed"; message: string };

/**
 * Drive an mp4 `File` through a frame-by-frame extraction pipeline, posting
 * each frame to `worker` and finishing with a `finish` message. Returns an
 * `abort()` handle.
 *
 * The function does NOT spawn the worker — callers manage worker lifecycle
 * so they can re-use a single onmessage handler for the worker's other
 * messages (`progress`, `done`, `failed`).
 */
export function extractFramesAndSendToWorker(
  file: File,
  worker: Worker,
  events: FrameExtractorEvents = {},
): FrameExtractor {
  let aborted = false;
  let video: HTMLVideoElement | null = null;
  let objectUrl: string | null = null;
  // Resolver for the next `frame-ack` from the worker — used to backpressure
  // the seek loop so we never have more than one in-flight frame.
  let pendingAck: { resolve: (index: number) => void; reject: (err: Error) => void } | null = null;
  // Resolver for the initial `inited` message.
  let pendingInit: { resolve: () => void; reject: (err: Error) => void } | null = null;

  // We add our own listener alongside the caller's so we can observe `inited`
  // and `frame-ack` without taking over the channel. The caller's listener
  // (set in build-state-context) still sees every message.
  const ackListener = (e: MessageEvent) => {
    const data = e.data as WorkerInbound;
    if (data.type === "inited") {
      pendingInit?.resolve();
      pendingInit = null;
    } else if (data.type === "frame-ack") {
      pendingAck?.resolve(data.index);
      pendingAck = null;
    } else if (data.type === "failed") {
      const err = new Error(`matting worker failed: ${data.message}`);
      pendingInit?.reject(err);
      pendingAck?.reject(err);
      pendingInit = null;
      pendingAck = null;
    }
  };
  worker.addEventListener("message", ackListener);

  function cleanup() {
    worker.removeEventListener("message", ackListener);
    if (video) {
      video.removeAttribute("src");
      video.load();
      if (video.parentNode) video.parentNode.removeChild(video);
      video = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function fail(err: Error) {
    if (aborted) return;
    aborted = true;
    cleanup();
    events.onError?.(err);
  }

  async function run() {
    try {
      // 1. Mount a hidden video element and load the file.
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      // Position offscreen but keep the element in the DOM — some browsers refuse to
      // decode/seek a fully detached video element reliably.
      video.style.position = "fixed";
      video.style.top = "-9999px";
      video.style.left = "-9999px";
      video.style.width = "1px";
      video.style.height = "1px";
      document.body.appendChild(video);

      objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      // `loadedmetadata` is the first event where videoWidth/Height/duration
      // are reliable. We also race against the video's `error` event so a
      // decode failure surfaces as an Error instead of hanging the extractor.
      await new Promise<void>((resolve, reject) => {
        const v = video;
        if (!v) {
          reject(new Error("video element gone before metadata load"));
          return;
        }
        const onMeta = () => {
          v.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = () => {
          v.removeEventListener("loadedmetadata", onMeta);
          reject(new Error("video element failed to load source"));
        };
        v.addEventListener("loadedmetadata", onMeta, { once: true });
        v.addEventListener("error", onErr, { once: true });
      });
      if (aborted) return;

      const v = video;
      if (!v) throw new Error("video element gone before extraction");
      const width = v.videoWidth;
      const height = v.videoHeight;
      if (width === 0 || height === 0) {
        throw new Error("video reports zero dimensions");
      }
      // Snap to whole frames at the canonical FPS. Floor — never count a partial frame.
      const totalFrames = Math.max(1, Math.floor(v.duration * FPS));
      const meta: FrameExtractorMeta = { width, height, totalFrames, fps: FPS };
      events.onMeta?.(meta);

      // 2. Init the worker. We need the encoder/muxer up before we ship any frames.
      const initPromise = new Promise<void>((resolve, reject) => {
        pendingInit = { resolve, reject };
      });
      worker.postMessage({ type: "init", width, height, totalFrames, fps: FPS });
      await initPromise;
      if (aborted) return;

      // 3. Reusable OffscreenCanvas — created once, reused per frame. We rely on
      // transferToImageBitmap() detaching the canvas backing store, which leaves
      // the canvas itself reusable for the next draw call.
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");

      // 4. Frame loop. Backpressure on frame-ack — we never queue more than one
      // bitmap in the worker, which keeps GPU memory bounded.
      for (let index = 0; index < totalFrames; index++) {
        if (aborted) return;
        // Seek to mid-frame for accuracy: `(index + 0.5) / fps` lands inside the
        // frame's display interval, avoiding boundary ambiguities where a seek
        // to an exact frame edge can land on the previous frame.
        const t = (index + 0.5) / FPS;
        await seekTo(v, t);
        if (aborted) return;

        ctx.drawImage(v, 0, 0, width, height);
        const bitmap = canvas.transferToImageBitmap();

        // ImageBitmap is Transferable — pass it in the transfer list for a
        // zero-copy handoff to the worker. The microsecond timestamp uses
        // the seek target (not v.currentTime) so the worker sees an exact,
        // monotonically increasing 30 Hz clock.
        const timestamp = Math.round((index / FPS) * 1_000_000);
        const ackPromise = new Promise<number>((resolve, reject) => {
          pendingAck = { resolve, reject };
        });
        worker.postMessage({ type: "frame", bitmap, timestamp, index }, [bitmap]);
        await ackPromise;
        if (aborted) return;
        events.onFrame?.(index);
      }

      // 5. Finish — worker flushes encoder + muxer and posts `done`.
      worker.postMessage({ type: "finish" });
      cleanup();
      events.onDone?.();
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }
  }

  // Kick off async — caller gets `{abort}` synchronously.
  void run();

  return {
    abort: () => {
      if (aborted) return;
      aborted = true;
      // Reject any pending acks so the run-loop bails out promptly. We DON'T
      // post `abort` to the worker here — the caller terminates the worker
      // in build-state-context's abortMatting, which is more reliable than
      // a graceful in-band abort message.
      const err = new Error("frame extractor aborted");
      pendingInit?.reject(err);
      pendingAck?.reject(err);
      pendingInit = null;
      pendingAck = null;
      cleanup();
    },
  };
}

/**
 * Seek the video to `t` seconds and wait for the `seeked` event. Adds a tiny
 * epsilon when the requested time equals `currentTime` — some browsers no-op
 * an exact-same seek and never re-fire `seeked`.
 */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const target = video.currentTime === t ? t + 1e-6 : t;
    const onSeeked = () => {
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error(`video seek failed at t=${t}`));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onErr, { once: true });
    video.currentTime = target;
  });
}
