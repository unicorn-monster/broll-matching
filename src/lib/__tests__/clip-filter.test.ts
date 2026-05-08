import { describe, it, expect } from "vitest";
import { filterClipsByQuery } from "../clip-filter";

type Clip = { id: string; brollName: string; filename: string; durationMs: number; fileId: string; folderId: string };

const clips: Clip[] = [
  { id: "1", brollName: "ump-clipper-compressthenail-01", filename: "clip_compress.mp4", durationMs: 3710, fileId: "k1", folderId: "f1" },
  { id: "2", brollName: "ump-clipper-cutthequick-01",    filename: "clip_cut.mp4",      durationMs: 5080, fileId: "k2", folderId: "f1" },
  { id: "3", brollName: "fs-dremel-loadnshake-01",       filename: "dremel_load.mov",   durationMs: 2000, fileId: "k3", folderId: "f2" },
];

describe("filterClipsByQuery", () => {
  it("returns all clips when query is empty", () => {
    expect(filterClipsByQuery(clips, "")).toEqual(clips);
  });

  it("returns all clips when query is whitespace only", () => {
    expect(filterClipsByQuery(clips, "   ")).toEqual(clips);
  });

  it("matches brollName case-insensitively", () => {
    const result = filterClipsByQuery(clips, "CLIPPER");
    expect(result.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("matches filename case-insensitively", () => {
    const result = filterClipsByQuery(clips, "dremel");
    expect(result.map((c) => c.id)).toEqual(["3"]);
  });

  it("matches filename when brollName does not match", () => {
    const result = filterClipsByQuery(clips, "clip_cut");
    expect(result.map((c) => c.id)).toEqual(["2"]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterClipsByQuery(clips, "zzzzzz")).toEqual([]);
  });

  it("matches substring", () => {
    const result = filterClipsByQuery(clips, "nail");
    expect(result.map((c) => c.id)).toEqual(["1"]);
  });
});
