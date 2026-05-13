"use client";

import { useRef } from "react";
import { Music, Video, X } from "lucide-react";

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

interface TalkingHeadUploadProps {
  file: File | null;
  duration: number | null;
  tag: string;
  tagInScript: boolean;
  onFile: (file: File | null, duration: number | null) => void;
  onTagChange: (tag: string) => void;
}

export function TalkingHeadUpload({
  file,
  duration,
  tag,
  tagInScript,
  onFile,
  onTagChange,
}: TalkingHeadUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".mp4")) {
      alert("Talking-head must be an MP4 file.");
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = URL.createObjectURL(f);
    video.onloadedmetadata = () => {
      onFile(f, video.duration);
      URL.revokeObjectURL(video.src);
    };
    onFile(f, null);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Talking-head (optional, silent MP4)</p>
      {file ? (
        <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
          <Video className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.name}</p>
            {duration !== null && <p className="text-xs text-muted-foreground">{formatDuration(duration)}</p>}
          </div>
          <button onClick={() => onFile(null, null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-2 cursor-pointer hover:bg-muted/20"
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <Video className="w-6 h-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Drop MP4 here or click to browse</p>
          <input ref={inputRef} type="file" accept=".mp4" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tag</label>
        <input
          type="text"
          value={tag}
          onChange={(e) => onTagChange(e.target.value)}
          placeholder="talking-head"
          className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        />
        {!tagInScript && tag.length > 0 && (
          <p className="text-xs text-amber-500">
            Tag &quot;{tag}&quot; does not appear in the parsed script.
          </p>
        )}
      </div>
    </div>
  );
}
