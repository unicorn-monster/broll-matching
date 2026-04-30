const VIDEO_EXTS = [".mp4", ".mov", ".webm"];
const AUDIO_EXTS = [".mp3", ".wav", ".m4a"];

export interface CategorizedFiles {
  videos: File[];
  audios: File[];
}

function hasExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export function categorizeFiles(files: File[]): CategorizedFiles {
  const videos: File[] = [];
  const audios: File[] = [];
  for (const f of files) {
    if (hasExt(f.name, VIDEO_EXTS)) videos.push(f);
    else if (hasExt(f.name, AUDIO_EXTS)) audios.push(f);
  }
  return { videos, audios };
}

export async function* walkDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): AsyncGenerator<File, void, unknown> {
  for await (const entry of (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      yield await fileHandle.getFile();
    } else if (entry.kind === "directory") {
      yield* walkDirectoryHandle(entry as FileSystemDirectoryHandle);
    }
  }
}

export async function pickFolder(): Promise<CategorizedFiles> {
  if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
    throw new Error("showDirectoryPicker not supported (Chrome/Edge required)");
  }
  // @ts-expect-error showDirectoryPicker is missing from lib.dom on some TS versions
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: "read" });
  const all: File[] = [];
  for await (const file of walkDirectoryHandle(handle)) {
    all.push(file);
  }
  return categorizeFiles(all);
}
