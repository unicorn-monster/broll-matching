"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMediaPool } from "@/state/media-pool";
import { OutputSizeSelect, type OutputSize, isValidSize } from "@/components/render/output-size-select";
import type { MatchedSection } from "@/lib/auto-match";
import { useBuildState } from "@/components/build/build-state-context";
import { renderTextOverlayToPNGBytes } from "@/lib/text-overlay/text-overlay-render";
import type { TextOverlay } from "@/lib/overlay/overlay-types";

interface RenderTriggerProps {
  audioFile: File;
  audioDurationMs: number;
  timeline: MatchedSection[];
  includeCaptions?: boolean;
}

export function RenderTrigger({ audioFile, audioDurationMs, timeline, includeCaptions = false }: RenderTriggerProps) {
  const [rendering, setRendering] = useState(false);
  const [stage, setStage] = useState<"uploading" | "rendering" | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const mediaPool = useMediaPool();
  const { talkingHeadLayers, talkingHeadFiles, overlays } = useBuildState();
  const [outputSize, setOutputSize] = useState<OutputSize>({ width: 1080, height: 1350 });

  useEffect(() => {
    if (!rendering) return;
    startedAtRef.current = Date.now();
    setElapsedSec(0);
    const id = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [rendering]);

  useEffect(() => {
    return () => {
      xhrRef.current?.abort();
    };
  }, []);

  async function startRender() {
    setError(null);
    setRendering(true);
    setStage("uploading");
    setUploadPct(0);

    try {
      const fd = new FormData();
      fd.append("timeline", JSON.stringify(timeline));
      fd.append("outputWidth", String(outputSize.width));
      fd.append("outputHeight", String(outputSize.height));
      fd.append("audioDurationMs", String(audioDurationMs));
      fd.append("audio", audioFile, audioFile.name || "audio.mp3");

      const usedFileIds = new Set(
        timeline.flatMap((s) =>
          s.clips.filter((c) => !c.isPlaceholder).map((c) => c.fileId),
        ),
      );
      for (const fileId of usedFileIds) {
        const file = mediaPool.getFile(fileId);
        // Re-wrap with the fileId as the File.name so the server can map it back to
        // timeline entries — the original File.name may not be the same as the fileId.
        if (file) fd.append("clips", new File([file], fileId));
      }

      // Append every talking-head layer file used by the timeline. Each layer has its
      // own fileId (prefixed `__th_layer__`) so the server keys clips back to the right MP4.
      for (const layer of talkingHeadLayers) {
        if (!usedFileIds.has(layer.fileId)) continue;
        const file = talkingHeadFiles.get(layer.fileId);
        if (file) fd.append("clips", new File([file], layer.fileId));
      }

      // Caption payload: PNG per visible text overlay + JSON metadata (timing + pixel position).
      // PNGs are cropped to each overlay's measured box, so ffmpeg `overlay=x:y` places them
      // exactly where the editor's canvas preview shows them. Dimensions match `outputSize`
      // so pixel positions are valid in the same coordinate space as the server-side video.
      if (includeCaptions) {
        const texts = overlays.filter((o): o is TextOverlay => o.kind === "text");
        const captionMeta: Array<{
          index: number;
          startMs: number;
          endMs: number;
          xPx: number;
          yPx: number;
        }> = [];
        for (const t of texts) {
          const text = t.text || "";
          if (text.trim().length === 0) continue;
          const { bytes, box } = await renderTextOverlayToPNGBytes(
            text,
            t,
            outputSize.width,
            outputSize.height,
          );
          // Wrap Uint8Array → Blob → File so FormData ships it as a binary part.
          const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
          fd.append(
            "captions",
            new File([blob], `caption-${captionMeta.length}.png`, { type: "image/png" }),
          );
          captionMeta.push({
            index: captionMeta.length,
            startMs: t.startMs,
            endMs: t.startMs + t.durationMs,
            xPx: box.x,
            yPx: box.y,
          });
        }
        if (captionMeta.length > 0) {
          fd.append("captionsMetadata", JSON.stringify(captionMeta));
        }
      }

      const blob = await postWithProgress("/api/render", fd, {
        onUploadProgress: (loaded, total) => {
          if (total > 0) setUploadPct(loaded / total);
        },
        onUploadComplete: () => setStage("rendering"),
        registerXhr: (xhr) => { xhrRef.current = xhr; },
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vsl-${Date.now()}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[render]", message);
      setError(`Render failed: ${message}`);
    } finally {
      setRendering(false);
      setStage(null);
      setUploadPct(0);
      xhrRef.current = null;
    }
  }

  const showUploadBar = stage === "uploading";
  const uploadPctRounded = Math.round(uploadPct * 100);
  const label =
    stage === "uploading"
      ? `Uploading clips… ${uploadPctRounded}%`
      : stage === "rendering"
        ? "Rendering on server (ffmpeg native)…"
        : "";

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p>
      )}
      {rendering && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{label}</span>
            <span className="tabular-nums">{formatElapsed(elapsedSec)}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={
                showUploadBar
                  ? "h-full bg-primary transition-[width] duration-150"
                  : "h-full bg-primary/40 animate-pulse w-1/3"
              }
              style={showUploadBar ? { width: `${uploadPctRounded}%` } : undefined}
            />
          </div>
        </div>
      )}
      <OutputSizeSelect value={outputSize} onChange={setOutputSize} />
      <Button
        onClick={startRender}
        disabled={rendering || !isValidSize(outputSize)}
        className="w-full"
        size="lg"
      >
        {rendering ? "Rendering…" : "Render Video"}
      </Button>
    </div>
  );
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface PostOpts {
  onUploadProgress: (loaded: number, total: number) => void;
  onUploadComplete: () => void;
  registerXhr: (xhr: XMLHttpRequest) => void;
}

/**
 * POST FormData with upload-progress tracking. `fetch` cannot report upload progress in
 * any browser as of 2026, so XHR is the only way to drive a real upload bar. Resolves to
 * a Blob for `application/octet-stream`-style downloads (response body is the rendered MP4).
 */
function postWithProgress(url: string, body: FormData, opts: PostOpts): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "blob";
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) opts.onUploadProgress(ev.loaded, ev.total);
    };
    xhr.upload.onload = () => opts.onUploadComplete();
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as Blob);
      } else {
        // Server returned JSON error — read it through a FileReader since responseType is blob.
        const blob = xhr.response as Blob;
        blob.text().then(
          (text) => {
            try {
              const parsed = JSON.parse(text) as { error?: string };
              reject(new Error(parsed.error ?? `Server error ${xhr.status}`));
            } catch {
              reject(new Error(`Server error ${xhr.status}: ${text.slice(0, 300)}`));
            }
          },
          () => reject(new Error(`Server error ${xhr.status}`)),
        );
      }
    };
    opts.registerXhr(xhr);
    xhr.send(body);
  });
}
