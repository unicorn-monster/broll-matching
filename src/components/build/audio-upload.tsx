"use client";

import { useState, useRef, useCallback } from "react";
import { Music, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AudioUploadProps {
  onAudioSelected: (file: File, durationMs: number) => void;
  onAudioCleared: () => void;
  selectedFile: File | null;
  durationMs: number | null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const url = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      resolve(Math.round(audio.duration * 1000));
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read audio metadata"));
    };
    audio.src = url;
  });
}

export function AudioUpload({
  onAudioSelected,
  onAudioCleared,
  selectedFile,
  durationMs,
}: AudioUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.type.startsWith("audio/")) {
        setError("Please select an audio file (MP3, M4A, WAV, etc.)");
        return;
      }
      try {
        const ms = await getAudioDuration(file);
        onAudioSelected(file, ms);
      } catch {
        setError("Could not read audio duration. Try a different file.");
      }
    },
    [onAudioSelected]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  if (selectedFile && durationMs !== null) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-muted">
        <Music className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{selectedFile.name}</p>
          <p className="text-xs text-muted-foreground">{formatDuration(durationMs)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onAudioCleared}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div
        className={cn(
          "border-2 border-dashed rounded-md p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors",
          isDragOver
            ? "border-foreground bg-muted"
            : "border-border hover:border-muted-foreground"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Music className="w-6 h-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center">
          Drop an audio file here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground">MP3, M4A, WAV, AAC…</p>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
