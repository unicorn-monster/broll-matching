import { describe, it, expect } from "vitest";
import {
  addLayer,
  removeLayer,
  renameLayer,
  findLayerByTag,
  migrateFromLegacyTh,
} from "../talking-head-store";

describe("addLayer", () => {
  it("returns { ok: true, layers } when tag is unique", () => {
    const result = addLayer([], { tag: "doctor", file: new File([], "doctor.mp4") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.tag).toBe("doctor");
    expect(result.layers[0]!.fileId.startsWith("__th_layer__")).toBe(true);
  });

  it("lowercases and trims the tag", () => {
    const result = addLayer([], { tag: "  Doctor  ", file: new File([], "x.mp4") });
    expect(result.ok && result.layers[0]!.tag).toBe("doctor");
  });

  it("returns { ok: false } when tag already in use (case-insensitive)", () => {
    const seed = addLayer([], { tag: "doc", file: new File([], "a.mp4") });
    if (!seed.ok) throw new Error("seed failed");
    const result = addLayer(seed.layers, { tag: "DOC", file: new File([], "b.mp4") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate-tag");
  });

  it("rejects empty tag", () => {
    const result = addLayer([], { tag: "   ", file: new File([], "x.mp4") });
    expect(result.ok).toBe(false);
  });
});

describe("removeLayer", () => {
  it("removes by id", () => {
    const seed = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error("seed failed");
    const out = removeLayer(seed.layers, seed.layers[0]!.id);
    expect(out).toHaveLength(0);
  });
});

describe("renameLayer", () => {
  it("changes tag when new tag is unique", () => {
    const seed = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error("seed failed");
    const result = renameLayer(seed.layers, seed.layers[0]!.id, "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers[0]!.tag).toBe("b");
  });

  it("rejects rename to a tag used by another layer", () => {
    const s1 = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!s1.ok) throw new Error();
    const s2 = addLayer(s1.layers, { tag: "b", file: new File([], "2.mp4") });
    if (!s2.ok) throw new Error();
    const result = renameLayer(s2.layers, s2.layers[1]!.id, "A");
    expect(result.ok).toBe(false);
  });

  it("allows rename when the only conflict is the same layer", () => {
    const seed = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error();
    const result = renameLayer(seed.layers, seed.layers[0]!.id, "A");
    expect(result.ok).toBe(true);
  });
});

describe("findLayerByTag", () => {
  it("matches lowercased tag", () => {
    const seed = addLayer([], { tag: "doc", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error();
    expect(findLayerByTag(seed.layers, "Doc")?.tag).toBe("doc");
    expect(findLayerByTag(seed.layers, "missing")).toBeUndefined();
  });
});

describe("migrateFromLegacyTh", () => {
  it("returns empty array when no legacy state", () => {
    expect(migrateFromLegacyTh(null, "")).toEqual({ layers: [], files: new Map() });
  });

  it("returns one layer when legacy file + tag are present", () => {
    const file = new File([], "legacy.mp4");
    const result = migrateFromLegacyTh(file, "talking-head");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.tag).toBe("talking-head");
    expect(result.files.size).toBe(1);
    expect(result.files.get(result.layers[0]!.fileId)).toBe(file);
  });
});
