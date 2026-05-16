"use client";

import { useRef } from "react";
import { Music, X } from "lucide-react";

interface AudioUploadProps {
  file: File | null;
  duration: number | null;
  onFile: (file: File | null, duration: number | null) => void;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioUpload({ file, duration, onFile }: AudioUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".mp3")) {
      alert("Only MP3 files are supported.");
      return;
    }
    const audio = new Audio(URL.createObjectURL(f));
    audio.onloadedmetadata = () => {
      onFile(f, audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    onFile(f, null);
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
        <Music className="w-5 h-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          {duration !== null && <p className="text-xs text-muted-foreground">{formatDuration(duration)}</p>}
        </div>
        <button onClick={() => onFile(null, null)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer hover:bg-muted/20"
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
    >
      <Music className="w-8 h-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Drop MP3 here or click to browse</p>
      <input ref={inputRef} type="file" accept=".mp3" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}

