"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { loadFFmpeg } from "@/lib/ffmpeg";
import { saveClip, saveThumbnail, deleteClip as deleteFromIndexedDB } from "@/lib/clip-storage";
import { cn } from "@/lib/utils";

interface ClipUploadProps {
  productId: string;
  tagId: string;
  onUploaded: () => void;
  compact?: boolean;
}

type Stage =
  | "idle"
  | "loading-ffmpeg"
  | "transcoding"
  | "extracting"
  | "storing"
  | "saving";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "",
  "loading-ffmpeg": "Loading FFmpeg...",
  transcoding: "Transcoding...",
  extracting: "Extracting thumbnail...",
  storing: "Storing locally...",
  saving: "Saving metadata...",
};

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      resolve(Math.round(video.duration * 1000));
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read video metadata"));
    };
    video.src = url;
  });
}

export function ClipUpload({
  productId,
  tagId,
  onUploaded,
  compact = false,
}: ClipUploadProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = stage !== "idle";

  const processFile = useCallback(
    async (file: File) => {
      if (uploading) return;

      // Validate file type
      if (!file.name.toLowerCase().endsWith(".mp4") && file.type !== "video/mp4") {
        toast.error("Only MP4 files are supported");
        return;
      }

      const clipId = crypto.randomUUID();

      try {
        // Get duration from original file
        let durationMs: number;
        try {
          durationMs = await getVideoDuration(file);
        } catch {
          toast.error("Could not read video duration");
          return;
        }

        // Load FFmpeg
        setStage("loading-ffmpeg");
        setProgress(5);
        const ffmpeg = await loadFFmpeg();

        // Write input file to virtual FS
        const inputBuffer = await file.arrayBuffer();
        await ffmpeg.writeFile("input.mp4", new Uint8Array(inputBuffer));

        // Transcode to 1080x1350 H.264
        setStage("transcoding");
        setProgress(10);

        ffmpeg.on("progress", ({ progress: p }) => {
          // Map 0-1 to 10-65%
          setProgress(10 + Math.round(p * 55));
        });

        await ffmpeg.exec([
          "-i", "input.mp4",
          "-vf", "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2",
          "-c:v", "libx264",
          "-preset", "fast",
          "-an",
          "transcoded.mp4",
        ]);

        // Delete input to free virtual FS memory
        await ffmpeg.deleteFile("input.mp4");

        // Extract thumbnail at 1s
        setStage("extracting");
        setProgress(65);

        ffmpeg.on("progress", ({ progress: p }) => {
          setProgress(65 + Math.round(p * 15));
        });

        await ffmpeg.exec([
          "-i", "transcoded.mp4",
          "-ss", "00:00:01",
          "-frames:v", "1",
          "-f", "image2",
          "thumbnail.jpg",
        ]);

        // Read outputs
        const transcodedData = await ffmpeg.readFile("transcoded.mp4") as Uint8Array;
        const thumbnailData = await ffmpeg.readFile("thumbnail.jpg") as Uint8Array;

        // Cleanup virtual FS
        await ffmpeg.deleteFile("transcoded.mp4");
        await ffmpeg.deleteFile("thumbnail.jpg");

        // Store in IndexedDB
        setStage("storing");
        setProgress(82);

        await saveClip(clipId, productId, transcodedData.buffer as ArrayBuffer);
        await saveThumbnail(clipId, thumbnailData.buffer as ArrayBuffer);

        // Save metadata to Postgres
        setStage("saving");
        setProgress(90);

        const res = await fetch(
          `/api/products/${productId}/tags/${tagId}/clips`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: clipId,
              filename: file.name,
              durationMs,
              width: 1080,
              height: 1350,
              indexeddbKey: clipId,
              fileSizeBytes: transcodedData.byteLength,
            }),
          }
        );

        if (!res.ok) {
          // Rollback IndexedDB on metadata save failure
          await deleteFromIndexedDB(clipId);
          throw new Error("Failed to save clip metadata");
        }

        setProgress(100);
        toast.success(`${file.name} uploaded`);
        onUploaded();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast.error(message);
      } finally {
        setStage("idle");
        setProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [uploading, productId, tagId, onUploaded]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  if (compact) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,.mp4"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs h-7"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              {STAGE_LABELS[stage]}
            </>
          ) : (
            <>
              <Upload className="w-3 h-3" />
              Upload
            </>
          )}
        </Button>
      </>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,.mp4"
        className="hidden"
        onChange={handleFileChange}
      />

      {uploading ? (
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium">{STAGE_LABELS[stage]}</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">{progress}%</p>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "w-full max-w-sm border-2 border-dashed rounded-lg px-6 py-8 flex flex-col items-center gap-2 cursor-pointer transition-colors",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-foreground/30 hover:bg-muted/30"
          )}
        >
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Upload className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Drop an MP4 here</p>
            <p className="text-xs text-muted-foreground mt-0.5">or click to browse</p>
          </div>
          <p className="text-xs text-muted-foreground/60">
            Will be transcoded to 1080×1350 H.264
          </p>
        </div>
      )}
    </>
  );
}
