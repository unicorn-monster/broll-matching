import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "broll-auto-assembly";
const DB_VERSION = 2;

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains("clips")) {
          db.deleteObjectStore("clips");
        }
        if (db.objectStoreNames.contains("thumbnails")) {
          db.deleteObjectStore("thumbnails");
        }
      }
      if (!db.objectStoreNames.contains("clips")) {
        db.createObjectStore("clips");
      }
      if (!db.objectStoreNames.contains("thumbnails")) {
        db.createObjectStore("thumbnails");
      }
    },
  });
}

export async function saveClip(id: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put("clips", data, id);
}

export async function saveThumbnail(clipId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put("thumbnails", data, clipId);
}

export async function getClip(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return db.get("clips", id);
}

export async function getThumbnail(clipId: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return db.get("thumbnails", clipId);
}

export async function deleteClip(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("clips", id);
  await db.delete("thumbnails", id);
}

export async function deleteProductClips(clipIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["clips", "thumbnails"], "readwrite");
  await Promise.all(
    clipIds.flatMap((id) => [
      tx.objectStore("clips").delete(id),
      tx.objectStore("thumbnails").delete(id),
    ]),
  );
  await tx.done;
}
