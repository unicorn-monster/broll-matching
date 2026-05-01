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

export function groupFilesByFolder(files: FileList | File[]): Map<string, File[]> {
  const map = new Map<string, File[]>();
  for (const file of Array.from(files)) {
    const key = file.webkitRelativePath
      ? file.webkitRelativePath.split("/")[0] ?? file.name
      : file.name;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(file);
  }
  return map;
}

export async function* walkDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): AsyncGenerator<File, void, unknown> {
  for await (const entry of (handle as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      yield await fileHandle.getFile();
    } else if (entry.kind === "directory") {
      yield* walkDirectoryHandle(entry as FileSystemDirectoryHandle);
    }
  }
}

export async function walkDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const files: File[] = [];
  const reader = entry.createReader();
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    for (const e of batch) {
      if (e.isFile) {
        files.push(
          await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)),
        );
      } else if (e.isDirectory) {
        files.push(...(await walkDirectoryEntry(e as FileSystemDirectoryEntry)));
      }
    }
  } while (batch.length > 0);
  return files;
}
