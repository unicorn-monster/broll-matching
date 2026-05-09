import { openDB, deleteDB, type IDBPDatabase } from "idb";

const DB_NAME = "vsl-mix-n-match";
const DB_VERSION = 1;

export interface FolderRecord {
  id: string;
  name: string;
  createdAt: Date;
}

export interface ClipRecord {
  id: string;
  folderId: string;
  brollName: string;
  baseName: string;
  durationMs: number;
  fileId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface FileRecord {
  id: string;
  blob: Blob;
  type: string;
  filename: string;
}

export type MediaDB = IDBPDatabase<unknown>;

export async function openMediaDB(): Promise<MediaDB> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("folders")) {
        db.createObjectStore("folders", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("clips")) {
        const clips = db.createObjectStore("clips", { keyPath: "id" });
        clips.createIndex("folderId", "folderId", { unique: false });
      }
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    },
  });
}

export async function deleteMediaDB(): Promise<void> {
  await deleteDB(DB_NAME);
}

export async function addFolderWithClips(
  folder: FolderRecord,
  clips: ClipRecord[],
  files: FileRecord[],
): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["folders", "clips", "files"], "readwrite");
  await Promise.all([
    tx.objectStore("folders").put(folder),
    ...clips.map((c) => tx.objectStore("clips").put(c)),
    ...files.map((f) => tx.objectStore("files").put(f)),
    tx.done,
  ]);
  db.close();
}

export async function getAllFolders(): Promise<FolderRecord[]> {
  const db = await openMediaDB();
  const all = await db.getAll("folders");
  db.close();
  return all as FolderRecord[];
}

export async function getAllClips(): Promise<ClipRecord[]> {
  const db = await openMediaDB();
  const all = await db.getAll("clips");
  db.close();
  return all as ClipRecord[];
}

export async function getFile(id: string): Promise<FileRecord | null> {
  const db = await openMediaDB();
  const rec = (await db.get("files", id)) as FileRecord | undefined;
  db.close();
  return rec ?? null;
}

export async function removeFolder(folderId: string): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["folders", "clips", "files"], "readwrite");
  const clipsStore = tx.objectStore("clips");
  const folderClips = (await clipsStore.index("folderId").getAll(folderId)) as ClipRecord[];
  await Promise.all([
    tx.objectStore("folders").delete(folderId),
    ...folderClips.map((c) => clipsStore.delete(c.id)),
    ...folderClips.map((c) => tx.objectStore("files").delete(c.fileId)),
    tx.done,
  ]);
  db.close();
}

export async function removeClip(clipId: string): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["clips", "files"], "readwrite");
  const clipsStore = tx.objectStore("clips");
  const clip = (await clipsStore.get(clipId)) as ClipRecord | undefined;
  await Promise.all([
    clipsStore.delete(clipId),
    clip ? tx.objectStore("files").delete(clip.fileId) : Promise.resolve(),
    tx.done,
  ]);
  db.close();
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction("folders", "readwrite");
  const existing = (await tx.objectStore("folders").get(id)) as FolderRecord | undefined;
  if (existing) {
    await tx.objectStore("folders").put({ ...existing, name });
  }
  await tx.done;
  db.close();
}

export async function resetAll(): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["folders", "clips", "files", "audio", "meta"], "readwrite");
  await Promise.all([
    tx.objectStore("folders").clear(),
    tx.objectStore("clips").clear(),
    tx.objectStore("files").clear(),
    tx.objectStore("audio").clear(),
    tx.objectStore("meta").clear(),
    tx.done,
  ]);
  db.close();
}
