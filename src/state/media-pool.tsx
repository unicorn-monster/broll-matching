"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ClipMetadata } from "@/lib/auto-match";

export interface AudioFileEntry {
  id: string;
  filename: string;
  file: File;
}

interface MediaPool {
  videos: ClipMetadata[];
  audios: AudioFileEntry[];
  fileMap: Map<string, File>;
  selectedAudioId: string | null;
  setMedia: (videos: ClipMetadata[], audios: AudioFileEntry[], fileMap: Map<string, File>) => void;
  selectAudio: (id: string | null) => void;
  reset: () => void;
  getFileURL: (fileId: string) => string | null;
  getFile: (fileId: string) => File | null;
}

const MediaPoolContext = createContext<MediaPool | null>(null);

export function MediaPoolProvider({ children }: { children: React.ReactNode }) {
  const [videos, setVideos] = useState<ClipMetadata[]>([]);
  const [audios, setAudios] = useState<AudioFileEntry[]>([]);
  const [fileMap, setFileMap] = useState<Map<string, File>>(new Map());
  const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
  const [urlCache] = useState<Map<string, string>>(new Map());

  const setMedia = useCallback(
    (v: ClipMetadata[], a: AudioFileEntry[], fm: Map<string, File>) => {
      for (const url of urlCache.values()) URL.revokeObjectURL(url);
      urlCache.clear();
      setVideos(v);
      setAudios(a);
      setFileMap(fm);
      setSelectedAudioId(null);
    },
    [urlCache],
  );

  const reset = useCallback(() => {
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
    setVideos([]);
    setAudios([]);
    setFileMap(new Map());
    setSelectedAudioId(null);
  }, [urlCache]);

  const getFile = useCallback((fileId: string) => fileMap.get(fileId) ?? null, [fileMap]);

  const getFileURL = useCallback(
    (fileId: string) => {
      const cached = urlCache.get(fileId);
      if (cached) return cached;
      const file = fileMap.get(fileId);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      urlCache.set(fileId, url);
      return url;
    },
    [fileMap, urlCache],
  );

  const value = useMemo<MediaPool>(
    () => ({
      videos, audios, fileMap, selectedAudioId,
      setMedia, selectAudio: setSelectedAudioId, reset, getFileURL, getFile,
    }),
    [videos, audios, fileMap, selectedAudioId, setMedia, reset, getFileURL, getFile],
  );

  return <MediaPoolContext.Provider value={value}>{children}</MediaPoolContext.Provider>;
}

export function useMediaPool(): MediaPool {
  const ctx = useContext(MediaPoolContext);
  if (!ctx) throw new Error("useMediaPool must be inside MediaPoolProvider");
  return ctx;
}
