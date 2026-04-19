"use client";

import { useState, useRef } from "react";
import { Upload, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filenameToBrollName, isValidBrollName } from "@/lib/broll";
import { saveClip, saveThumbnail } from "@/lib/clip-storage";
import { loadFFmpeg } from "@/lib/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

interface UploadRow {
  file: File;
  brollName: string;
  status: "ready" | "invalid" | "duplicate" | "uploading" | "done" | "error";
  error?: string;
  progress?: number;
}

interface ClipUploadProps {
  productId: string;
  folderId: string;
  onDone: () => void;
}

export function ClipUpload({ productId, folderId, onDone }: ClipUploadProps) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateRow(index: number, patch: Partial<UploadRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleFiles(files: File[]) {
    const mp4s = files.filter((f) => f.name.toLowerCase().endsWith(".mp4"));
    if (!mp4s.length) return;

    const res = await fetch(`/api/products/${productId}/clips`);
    const existing: { brollName: string }[] = await res.json();
    const existingNames = new Set(existing.map((c) => c.brollName));

    const newRows: UploadRow[] = mp4s.map((file) => {
      const brollName = filenameToBrollName(file.name);
      let status: UploadRow["status"] = "ready";
      if (!isValidBrollName(brollName)) status = "invalid";
      else if (existingNames.has(brollName)) status = "duplicate";
      return { file, brollName, status };
    });
    setRows((prev) => [...prev, ...newRows]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(Array.from(e.dataTransfer.files));
  }

  async function uploadAll() {
    const readyRows = rows.filter((r) => r.status === "ready");
    if (!readyRows.length) return;
    setUploading(true);

    let ffmpeg;
    try {
      console.log("[upload] loading ffmpeg…");
      ffmpeg = await loadFFmpeg();
      console.log("[upload] ffmpeg loaded");
    } catch (err) {
      console.error("[upload] ffmpeg load failed:", err);
      setRows((prev) =>
        prev.map((r) =>
          r.status === "ready"
            ? { ...r, status: "error", error: `ffmpeg load: ${String(err)}` }
            : r,
        ),
      );
      setUploading(false);
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== "ready") continue;
      updateRow(i, { status: "uploading", progress: 0 });

      let durationMs = 0;
      const logHandler = ({ message }: { type: string; message: string }) => {
        if (durationMs > 0) return;
        const m = message.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!m) return;
        const [, h, min, sec] = m;
        durationMs = Math.round((Number(h) * 3600 + Number(min) * 60 + Number(sec)) * 1000);
      };

      try {
        const inputName = `input-${i}.mp4`;
        const outputName = `output-${i}.mp4`;
        const thumbName = `thumb-${i}.jpg`;

        await ffmpeg.writeFile(inputName, await fetchFile(row.file));
        updateRow(i, { progress: 20 });

        ffmpeg.on("log", logHandler);
        try {
          await ffmpeg.exec([
            "-i", inputName,
            "-vf", "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "fast", "-an",
            outputName,
          ]);
          updateRow(i, { progress: 60 });

          await ffmpeg.exec([
            "-i", inputName, "-ss", "00:00:01", "-frames:v", "1", "-f", "image2", thumbName,
          ]);
        } finally {
          ffmpeg.off("log", logHandler);
        }
        updateRow(i, { progress: 70 });

        if (!durationMs) {
          throw new Error("could not parse duration from ffmpeg log");
        }

        const videoData = await ffmpeg.readFile(outputName) as Uint8Array;
        const thumbData = await ffmpeg.readFile(thumbName) as Uint8Array;

        const duration = durationMs;

        const clipId = crypto.randomUUID();
        await saveClip(clipId, videoData.buffer as ArrayBuffer);
        await saveThumbnail(clipId, thumbData.buffer as ArrayBuffer);
        updateRow(i, { progress: 85 });

        const metaRes = await fetch(`/api/products/${productId}/folders/${folderId}/clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brollName: row.brollName,
            filename: row.file.name,
            durationMs: duration,
            width: 1080,
            height: 1350,
            indexeddbKey: clipId,
            fileSizeBytes: videoData.byteLength,
          }),
        });

        if (!metaRes.ok) {
          const { deleteClip } = await import("@/lib/clip-storage");
          await deleteClip(clipId);
          const err = await metaRes.json();
          updateRow(i, { status: "error", error: err.error });
          continue;
        }

        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
        await ffmpeg.deleteFile(thumbName);

        updateRow(i, { status: "done", progress: 100 });
      } catch (err) {
        console.error(`[upload] row ${i} (${row.brollName}) failed:`, err);
        updateRow(i, { status: "error", error: String(err) });
      }
    }

    setUploading(false);
    if (rows.every((_, i) => rows[i].status === "done" || rows[i].status === "error")) {
      onDone();
    }
  }

  const readyCount = rows.filter((r) => r.status === "ready").length;

  return (
    <div className="border-2 border-dashed border-border rounded-lg p-4 space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex flex-col items-center gap-2 py-6 cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Drop MP4 files here or click to browse</p>
        <p className="text-xs text-muted-foreground">Files must be named: <code>base-name-01.mp4</code></p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".mp4"
        className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
      />

      {rows.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-muted/30">
              {row.status === "done" && <Check className="w-4 h-4 text-green-500 shrink-0" />}
              {row.status === "error" && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
              {(row.status === "invalid" || row.status === "duplicate") && (
                <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />
              )}
              {(row.status === "ready" || row.status === "uploading") && (
                <div className="w-4 h-4 shrink-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}

              {(row.status === "invalid" || row.status === "duplicate") ? (
                <Input
                  value={row.brollName}
                  onChange={(e) => {
                    const name = e.target.value;
                    const st = !isValidBrollName(name) ? "invalid" : "ready";
                    updateRow(i, { brollName: name, status: st });
                  }}
                  className="h-6 text-xs font-mono flex-1"
                />
              ) : (
                <span className="font-mono flex-1 truncate">{row.brollName}</span>
              )}

              <span className={`text-xs shrink-0 ${
                row.status === "invalid" ? "text-yellow-600" :
                row.status === "duplicate" ? "text-orange-600" :
                row.status === "error" ? "text-red-600" :
                row.status === "done" ? "text-green-600" : "text-muted-foreground"
              }`}>
                {row.status === "uploading" ? `${row.progress ?? 0}%` : row.status}
                {row.error ? `: ${row.error}` : ""}
              </span>

              <button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}

      {readyCount > 0 && (
        <Button onClick={uploadAll} disabled={uploading} className="w-full">
          {uploading ? "Uploading…" : `Upload ${readyCount} valid file${readyCount !== 1 ? "s" : ""}`}
        </Button>
      )}
    </div>
  );
}

