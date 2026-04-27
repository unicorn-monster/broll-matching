import { describe, it, expect } from "vitest";
import { filterFoldersByName } from "../folder-filter";

type Folder = { id: string; name: string; clipCount: number };

const folders: Folder[] = [
  { id: "f1", name: "FS-Clipper", clipCount: 11 },
  { id: "f2", name: "FS-Clipper-n-Dremel", clipCount: 1 },
  { id: "f3", name: "FS-Dremel", clipCount: 16 },
  { id: "f4", name: "Authority", clipCount: 0 },
  { id: "f5", name: "Before-after", clipCount: 6 },
];

describe("filterFoldersByName", () => {
  it("returns all folders when query is empty", () => {
    expect(filterFoldersByName(folders, "")).toEqual(folders);
  });

  it("returns all folders when query is whitespace only", () => {
    expect(filterFoldersByName(folders, "   ")).toEqual(folders);
  });

  it("matches name case-insensitively", () => {
    const result = filterFoldersByName(folders, "CLIPPER");
    expect(result.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("matches a substring within the name", () => {
    const result = filterFoldersByName(folders, "dremel");
    expect(result.map((f) => f.id)).toEqual(["f2", "f3"]);
  });

  it("trims surrounding whitespace before matching", () => {
    const result = filterFoldersByName(folders, "  authority  ");
    expect(result.map((f) => f.id)).toEqual(["f4"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterFoldersByName(folders, "zzzz")).toEqual([]);
  });
});
