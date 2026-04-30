import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  openMediaDB,
  deleteMediaDB,
  addFolderWithClips,
  getAllFolders,
  getAllClips,
  getFile,
  removeFolder,
  renameFolder,
  putAudio,
  getAudio,
  clearAudio,
  resetAll,
  type FolderRecord,
  type ClipRecord,
  type FileRecord,
  type AudioRecord,
} from "@/lib/media-storage";

beforeEach(async () => {
  await deleteMediaDB();
});

function makeClip(folderId: string, name: string, fileId: string): { clip: ClipRecord; file: FileRecord } {
  return {
    clip: {
      id: crypto.randomUUID(),
      folderId,
      brollName: name,
      baseName: name.replace(/-\d+$/, ""),
      durationMs: 1000,
      fileId,
      filename: `${name}.mp4`,
      width: 1920,
      height: 1080,
      fileSizeBytes: 100,
      createdAt: new Date(),
    },
    file: {
      id: fileId,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
      type: "video/mp4",
      filename: `${name}.mp4`,
    },
  };
}

describe("media-storage", () => {
  it("opens database with all required object stores", async () => {
    const db = await openMediaDB();
    const names = Array.from(db.objectStoreNames).sort();
    expect(names).toEqual(["audio", "clips", "files", "folders", "meta"]);
    db.close();
  });
});

describe("addFolderWithClips + reads", () => {
  it("persists folder, clips, and files in one operation", async () => {
    const folder: FolderRecord = { id: "f1", name: "hook", createdAt: new Date() };
    const f1 = crypto.randomUUID();
    const f2 = crypto.randomUUID();
    const e1 = makeClip("f1", "hook-01", f1);
    const e2 = makeClip("f1", "hook-02", f2);

    await addFolderWithClips(folder, [e1.clip, e2.clip], [e1.file, e2.file]);

    const folders = await getAllFolders();
    const clips = await getAllClips();
    const file = await getFile(f1);

    expect(folders).toHaveLength(1);
    expect(folders[0]!.name).toBe("hook");
    expect(clips).toHaveLength(2);
    expect(file).not.toBeNull();
    expect(file!.filename).toBe("hook-01.mp4");
  });
});

describe("removeFolder", () => {
  it("removes folder and cascades to its clips and files", async () => {
    const folderA: FolderRecord = { id: "fa", name: "a", createdAt: new Date() };
    const folderB: FolderRecord = { id: "fb", name: "b", createdAt: new Date() };
    const a1 = makeClip("fa", "a-01", crypto.randomUUID());
    const b1 = makeClip("fb", "b-01", crypto.randomUUID());

    await addFolderWithClips(folderA, [a1.clip], [a1.file]);
    await addFolderWithClips(folderB, [b1.clip], [b1.file]);

    await removeFolder("fa");

    const folders = await getAllFolders();
    const clips = await getAllClips();
    expect(folders.map((f) => f.id)).toEqual(["fb"]);
    expect(clips.map((c) => c.id)).toEqual([b1.clip.id]);
    expect(await getFile(a1.file.id)).toBeNull();
    expect(await getFile(b1.file.id)).not.toBeNull();
  });
});

describe("renameFolder", () => {
  it("updates only the folder name, leaves clips untouched", async () => {
    const folder: FolderRecord = { id: "f1", name: "old", createdAt: new Date() };
    const c1 = makeClip("f1", "x-01", crypto.randomUUID());
    await addFolderWithClips(folder, [c1.clip], [c1.file]);

    await renameFolder("f1", "new");

    const folders = await getAllFolders();
    const clips = await getAllClips();
    expect(folders[0]!.name).toBe("new");
    expect(clips[0]!.brollName).toBe("x-01");
  });
});

describe("audio singleton", () => {
  it("stores and retrieves a single audio record", async () => {
    const audio: AudioRecord = {
      id: "current",
      blob: new Blob([new Uint8Array([0, 1])], { type: "audio/mp3" }),
      type: "audio/mp3",
      filename: "song.mp3",
      durationMs: 30000,
    };
    await putAudio(audio);
    const got = await getAudio();
    expect(got?.filename).toBe("song.mp3");
    expect(got?.durationMs).toBe(30000);
  });

  it("clearAudio removes the singleton", async () => {
    const audio: AudioRecord = {
      id: "current",
      blob: new Blob([], { type: "audio/mp3" }),
      type: "audio/mp3",
      filename: "x.mp3",
      durationMs: 0,
    };
    await putAudio(audio);
    await clearAudio();
    expect(await getAudio()).toBeNull();
  });
});

describe("resetAll", () => {
  it("wipes folders, clips, files, and audio", async () => {
    const folder: FolderRecord = { id: "f1", name: "x", createdAt: new Date() };
    const c1 = makeClip("f1", "x-01", crypto.randomUUID());
    await addFolderWithClips(folder, [c1.clip], [c1.file]);
    await putAudio({
      id: "current",
      blob: new Blob([], { type: "audio/mp3" }),
      type: "audio/mp3",
      filename: "x.mp3",
      durationMs: 0,
    });

    await resetAll();

    expect(await getAllFolders()).toEqual([]);
    expect(await getAllClips()).toEqual([]);
    expect(await getAudio()).toBeNull();
  });
});
