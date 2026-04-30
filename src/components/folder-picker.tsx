"use client";

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pickFolder } from "@/lib/folder-import";
import { extractVideoMetadata } from "@/lib/video-metadata";
import { useMediaPool, type AudioFileEntry } from "@/state/media-pool";
import { filenameToBrollName, deriveBaseName, isValidBrollName } from "@/lib/broll";
import type { ClipMetadata } from "@/lib/auto-match";

interface Props {
  onLoaded: () => void;
}

export function FolderPicker({ onLoaded }: Props) {
  const { setMedia } = useMediaPool();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  async function handlePick() {
    setError(null);
    setBusy(true);
    try {
      const { videos, audios } = await pickFolder();
      if (videos.length === 0 && audios.length === 0) {
        setError("Không tìm thấy file media nào trong folder này");
        return;
      }
      setProgress({ done: 0, total: videos.length });

      const fileMap = new Map<string, File>();

      const videoMetas: ClipMetadata[] = [];
      let done = 0;
      await Promise.all(
        videos.map(async (file) => {
          try {
            const meta = await extractVideoMetadata(file);
            const fileId = crypto.randomUUID();
            const brollName = filenameToBrollName(file.name);
            if (!isValidBrollName(brollName)) {
              console.warn(`Skipping invalid broll name: ${file.name}`);
              return;
            }
            fileMap.set(fileId, file);
            videoMetas.push({
              id: fileId,
              brollName,
              baseName: deriveBaseName(brollName),
              durationMs: meta.durationMs,
              fileId,
              folderId: "local",
              productId: "local",
              filename: file.name,
              width: meta.width,
              height: meta.height,
              fileSizeBytes: file.size,
              createdAt: new Date(),
            });
          } catch (err) {
            console.warn(`Skipping ${file.name}:`, err);
          } finally {
            done++;
            setProgress({ done, total: videos.length });
          }
        }),
      );

      const audioEntries: AudioFileEntry[] = audios.map((file) => {
        const id = crypto.randomUUID();
        fileMap.set(id, file);
        return { id, filename: file.name, file };
      });

      setMedia(videoMetas, audioEntries, fileMap);
      onLoaded();
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <Button onClick={handlePick} disabled={busy} size="lg">
        {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FolderOpen className="w-5 h-5 mr-2" />}
        Chọn folder B-roll
      </Button>
      {busy && progress.total > 0 && (
        <div className="text-sm text-muted-foreground">
          Loading metadata: {progress.done}/{progress.total}
        </div>
      )}
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}
