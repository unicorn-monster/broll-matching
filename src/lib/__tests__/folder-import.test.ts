import { describe, it, expect } from "vitest";
import { categorizeFiles, walkDirectoryHandle, groupFilesByFolder, walkDirectoryEntry } from "../folder-import";

function makeFile(name: string): File {
  return new File(["x"], name, { type: "" });
}

describe("categorizeFiles", () => {
  it("splits files by extension into video/audio/other", () => {
    const files = [
      makeFile("a.mp4"),
      makeFile("b.MOV"),
      makeFile("c.webm"),
      makeFile("song.mp3"),
      makeFile("voice.WAV"),
      makeFile("track.m4a"),
      makeFile("note.txt"),
    ];
    const out = categorizeFiles(files);
    expect(out.videos.map((f) => f.name)).toEqual(["a.mp4", "b.MOV", "c.webm"]);
    expect(out.audios.map((f) => f.name)).toEqual(["song.mp3", "voice.WAV", "track.m4a"]);
  });
});

describe("walkDirectoryHandle", () => {
  it("recursively yields all File entries", async () => {
    const childFile = { kind: "file", name: "deep.mp4", getFile: async () => makeFile("deep.mp4") };
    const subDir = {
      kind: "directory",
      name: "sub",
      async *values() { yield childFile; },
    };
    const rootFile = { kind: "file", name: "root.mp3", getFile: async () => makeFile("root.mp3") };
    const root = {
      kind: "directory",
      name: "root",
      async *values() { yield rootFile; yield subDir; },
    };

    const collected: File[] = [];
    for await (const f of walkDirectoryHandle(root as never)) {
      collected.push(f);
    }
    expect(collected.map((f) => f.name).sort()).toEqual(["deep.mp4", "root.mp3"]);
  });
});

describe("groupFilesByFolder", () => {
  function makeRelFile(relPath: string): File {
    const f = new File(["x"], relPath.split("/").at(-1)!, { type: "" });
    Object.defineProperty(f, "webkitRelativePath", { value: relPath });
    return f;
  }

  it("groups files by top-level folder name from webkitRelativePath", () => {
    const files = [
      makeRelFile("authority/clip-01.mp4"),
      makeRelFile("authority/clip-02.mp4"),
      makeRelFile("benefit/b-01.mp4"),
    ];
    const grouped = groupFilesByFolder(files);
    expect(grouped.size).toBe(2);
    expect(grouped.get("authority")!.length).toBe(2);
    expect(grouped.get("benefit")!.length).toBe(1);
  });

  it("falls back to file.name when webkitRelativePath is empty", () => {
    const f = new File(["x"], "standalone.mp4", { type: "" });
    const grouped = groupFilesByFolder([f]);
    expect(grouped.size).toBe(1);
    expect(grouped.has("standalone.mp4")).toBe(true);
  });

  it("accepts a FileList-like array", () => {
    const files = [
      makeRelFile("hook/h1.mp4"),
      makeRelFile("hook/h2.mp4"),
      makeRelFile("data/d1.mp4"),
    ];
    const grouped = groupFilesByFolder(files);
    expect([...grouped.keys()].sort()).toEqual(["data", "hook"]);
  });
});

function fakeFileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => cb(new File(["x"], name, { type: "" })),
  } as unknown as FileSystemFileEntry;
}

function fakeDirEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  let done = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
        if (!done) { done = true; cb(children); } else cb([]);
      },
    }),
  } as unknown as FileSystemDirectoryEntry;
}

describe("walkDirectoryEntry", () => {
  it("collects all files from a flat directory", async () => {
    const entry = fakeDirEntry("root", [fakeFileEntry("a.mp4"), fakeFileEntry("b.mp4")]);
    const files = await walkDirectoryEntry(entry);
    expect(files.map((f) => f.name).sort()).toEqual(["a.mp4", "b.mp4"]);
  });

  it("recursively collects files from subdirectories", async () => {
    const entry = fakeDirEntry("root", [
      fakeFileEntry("top.mp4"),
      fakeDirEntry("sub", [fakeFileEntry("deep.mp4")]),
    ]);
    const files = await walkDirectoryEntry(entry);
    expect(files.map((f) => f.name).sort()).toEqual(["deep.mp4", "top.mp4"]);
  });

  it("handles directories with >100 items via batched readEntries", async () => {
    const allChildren: FileSystemFileEntry[] = Array.from({ length: 150 }, (_, i) =>
      fakeFileEntry(`f${i}.mp4`),
    );
    let call = 0;
    const entry = {
      isFile: false,
      isDirectory: true,
      name: "big",
      createReader: () => ({
        readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
          if (call === 0) { call++; cb(allChildren.slice(0, 100)); }
          else if (call === 1) { call++; cb(allChildren.slice(100)); }
          else cb([]);
        },
      }),
    } as unknown as FileSystemDirectoryEntry;
    const files = await walkDirectoryEntry(entry);
    expect(files.length).toBe(150);
  });

  it("returns empty array for an empty directory", async () => {
    const entry = fakeDirEntry("empty", []);
    const files = await walkDirectoryEntry(entry);
    expect(files).toEqual([]);
  });
});
