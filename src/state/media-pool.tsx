"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ClipMetadata } from "@/lib/auto-match";
import {
  getAllClips,
  getAllFolders,
  getFile as getFileRecord,
  type FolderRecord,
} from "@/lib/media-storage";

export interface FolderEntry {
  id: string;
  name: string;
  createdAt: Date;
}

export interface AddFolderResult {
  folderId: string;
  added: number;
  skipped: { filename: string; reason: string }[];
}

interface MediaPool {
  videos: ClipMetadata[];
  fileMap: Map<string, File>;
  folders: FolderEntry[];
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  hydrated: boolean;

  addFolder: (name: string, files: File[], options?: { mergeIntoFolderId?: string }) => Promise<AddFolderResult>;
  renameFolder: (id: string, name: string) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  reset: () => Promise<void>;

  getFile: (fileId: string) => File | null;
  getFileURL: (fileId: string) => string | null;
}

const MediaPoolContext = createContext<MediaPool | null>(null);

export function MediaPoolProvider({ children }: { children: React.ReactNode }) {
  const [videos, setVideos] = useState<ClipMetadata[]>([]);
  const [fileMap, setFileMap] = useState<Map<string, File>>(new Map());
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const urlCacheRef = useRef<Map<string, string>>(new Map());

  // Hydrate from IDB on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [folderRecs, clipRecs] = await Promise.all([getAllFolders(), getAllClips()]);
      if (cancelled) return;

      const newFileMap = new Map<string, File>();
      await Promise.all(
        clipRecs.map(async (c) => {
          const fr = await getFileRecord(c.fileId);
          if (fr) {
            newFileMap.set(c.fileId, new File([fr.blob], fr.filename, { type: fr.type }));
          }
        }),
      );

      if (cancelled) return;

      const clips: ClipMetadata[] = clipRecs.map((c) => ({
        id: c.id,
        brollName: c.brollName,
        baseName: c.baseName,
        durationMs: c.durationMs,
        fileId: c.fileId,
        folderId: c.folderId,
        filename: c.filename,
        width: c.width,
        height: c.height,
        fileSizeBytes: c.fileSizeBytes,
        createdAt: c.createdAt,
      }));

      setFolders(folderRecs.map((f: FolderRecord) => ({ id: f.id, name: f.name, createdAt: f.createdAt })));
      setVideos(clips);
      setFileMap(newFileMap);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getFile = useCallback((fileId: string) => fileMap.get(fileId) ?? null, [fileMap]);

  const getFileURL = useCallback(
    (fileId: string) => {
      const cache = urlCacheRef.current;
      const cached = cache.get(fileId);
      if (cached) return cached;
      const file = fileMap.get(fileId);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      cache.set(fileId, url);
      return url;
    },
    [fileMap],
  );

  const addFolder = useCallback(
    async (
      name: string,
      files: File[],
      options?: { mergeIntoFolderId?: string },
    ): Promise<AddFolderResult> => {
      const { addFolderWithClips } = await import("@/lib/media-storage");
      const { validateBrollFile } = await import("@/lib/broll-validation");
      const { extractVideoMetadata } = await import("@/lib/video-metadata");
      const { deriveBaseName } = await import("@/lib/broll");

      const folderId = options?.mergeIntoFolderId ?? crypto.randomUUID();
      const existingFolder = folders.find((f) => f.id === folderId);
      const folderRec = existingFolder ?? { id: folderId, name, createdAt: new Date() };

      const skipped: { filename: string; reason: string }[] = [];
      const existingNamesInFolder = new Set(
        videos.filter((v) => v.folderId === folderId).map((v) => v.brollName),
      );

      const acceptedClips: ClipMetadata[] = [];
      const acceptedFiles: { id: string; blob: Blob; type: string; filename: string }[] = [];

      await Promise.all(
        files.map(async (file) => {
          const result = validateBrollFile(file);
          if (!result.valid) {
            skipped.push({ filename: file.name, reason: result.reason });
            return;
          }
          if (existingNamesInFolder.has(result.brollName)) {
            skipped.push({ filename: file.name, reason: "broll name already exists in this folder" });
            return;
          }
          try {
            const meta = await extractVideoMetadata(file);
            const fileId = crypto.randomUUID();
            acceptedClips.push({
              id: fileId,
              brollName: result.brollName,
              baseName: deriveBaseName(result.brollName),
              durationMs: meta.durationMs,
              fileId,
              folderId,
              filename: file.name,
              width: meta.width,
              height: meta.height,
              fileSizeBytes: file.size,
              createdAt: new Date(),
            });
            acceptedFiles.push({ id: fileId, blob: file, type: file.type, filename: file.name });
          } catch {
            skipped.push({ filename: file.name, reason: "failed to read video metadata" });
          }
        }),
      );

      await addFolderWithClips(
        { id: folderRec.id, name: folderRec.name, createdAt: folderRec.createdAt },
        acceptedClips.map((c) => ({
          id: c.id,
          folderId: c.folderId,
          brollName: c.brollName,
          baseName: c.baseName,
          durationMs: c.durationMs,
          fileId: c.fileId,
          filename: c.filename,
          width: c.width,
          height: c.height,
          fileSizeBytes: c.fileSizeBytes,
          createdAt: c.createdAt,
        })),
        acceptedFiles,
      );

      setFolders((prev) =>
        options?.mergeIntoFolderId ? prev : [...prev, { id: folderRec.id, name: folderRec.name, createdAt: folderRec.createdAt }],
      );
      setVideos((prev) => [...prev, ...acceptedClips]);
      setFileMap((prev) => {
        const next = new Map(prev);
        for (const af of acceptedFiles) {
          next.set(af.id, new File([af.blob], af.filename, { type: af.type }));
        }
        return next;
      });

      return { folderId, added: acceptedClips.length, skipped };
    },
    [folders, videos],
  );

  const removeFolder = useCallback(
    async (id: string) => {
      const { removeFolder: removeFolderIDB } = await import("@/lib/media-storage");
      const folderClipFileIds = videos.filter((v) => v.folderId === id).map((v) => v.fileId);

      await removeFolderIDB(id);

      const cache = urlCacheRef.current;
      for (const fileId of folderClipFileIds) {
        const url = cache.get(fileId);
        if (url) {
          URL.revokeObjectURL(url);
          cache.delete(fileId);
        }
      }

      setFolders((prev) => prev.filter((f) => f.id !== id));
      setVideos((prev) => prev.filter((v) => v.folderId !== id));
      setFileMap((prev) => {
        const next = new Map(prev);
        for (const fid of folderClipFileIds) next.delete(fid);
        return next;
      });
      setActiveFolderId((cur) => (cur === id ? null : cur));
    },
    [videos],
  );

  const renameFolder = useCallback(async (id: string, name: string) => {
    const { renameFolder: renameFolderIDB } = await import("@/lib/media-storage");
    await renameFolderIDB(id, name);
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  }, []);

  const reset = useCallback(async () => {
    const { resetAll } = await import("@/lib/media-storage");
    await resetAll();
    const cache = urlCacheRef.current;
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    setFolders([]);
    setVideos([]);
    setFileMap(new Map());
    setActiveFolderId(null);
  }, []);

  const value = useMemo<MediaPool>(
    () => ({
      videos,
      fileMap,
      folders,
      activeFolderId,
      setActiveFolderId,
      hydrated,
      addFolder,
      renameFolder,
      removeFolder,
      reset,
      getFile,
      getFileURL,
    }),
    [videos, fileMap, folders, activeFolderId, hydrated, addFolder, renameFolder, removeFolder, reset, getFile, getFileURL],
  );

  return <MediaPoolContext.Provider value={value}>{children}</MediaPoolContext.Provider>;
}

export function useMediaPool(): MediaPool {
  const ctx = useContext(MediaPoolContext);
  if (!ctx) throw new Error("useMediaPool must be inside MediaPoolProvider");
  return ctx;
}
