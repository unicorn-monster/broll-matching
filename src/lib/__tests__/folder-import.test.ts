import { describe, it, expect } from "vitest";
import { categorizeFiles, walkDirectoryHandle } from "../folder-import";

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
