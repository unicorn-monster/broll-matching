import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "broll-auto-assembly";
const DB_VERSION = 1;

interface ClipRecord {
  id: string;
  productId: string;
  data: ArrayBuffer;
  mimeType: string;
}

interface ThumbnailRecord {
  id: string;
  data: ArrayBuffer;
  mimeType: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("clips")) {
          db.createObjectStore("clips", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("thumbnails")) {
          db.createObjectStore("thumbnails", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveClip(id: string, productId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  const record: ClipRecord = { id, productId, data, mimeType: "video/mp4" };
  await db.put("clips", record);
}

export async function saveThumbnail(clipId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  const record: ThumbnailRecord = { id: clipId, data, mimeType: "image/jpeg" };
  await db.put("thumbnails", record);
}

export async function getClip(id: string): Promise<ArrayBuffer | null> {
  const db = await getDB();
  const record = await db.get("clips", id) as ClipRecord | undefined;
  return record?.data ?? null;
}

export async function getThumbnail(clipId: string): Promise<ArrayBuffer | null> {
  const db = await getDB();
  const record = await db.get("thumbnails", clipId) as ThumbnailRecord | undefined;
  return record?.data ?? null;
}

export async function deleteClip(id: string): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.delete("clips", id),
    db.delete("thumbnails", id),
  ]);
}

export async function deleteProductClips(productId: string): Promise<void> {
  const db = await getDB();
  const allClips = await db.getAll("clips") as ClipRecord[];
  const productClips = allClips.filter((c) => c.productId === productId);
  await Promise.all(
    productClips.map((c) =>
      Promise.all([db.delete("clips", c.id), db.delete("thumbnails", c.id)])
    )
  );
}
