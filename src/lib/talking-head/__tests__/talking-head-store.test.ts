import { describe, expect, it } from "vitest";
import {
  addOrReplaceLayer,
  findLayerByTag,
  getLayerByKind,
  removeLayer,
} from "../talking-head-store";
import {
  FULL_LAYER_TAG,
  OVERLAY_LAYER_TAG,
} from "../talking-head-types";

function fakeFile(name = "x.mp4"): File {
  return new File([new Uint8Array([0])], name, { type: "video/mp4" });
}

describe("addOrReplaceLayer (kind-aware)", () => {
  it("adds a full layer when empty", () => {
    const r = addOrReplaceLayer([], { kind: "full", file: fakeFile() });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]!.kind).toBe("full");
    expect(r.layers[0]!.tag).toBe(FULL_LAYER_TAG);
  });

  it("replaces an existing full layer (keeping at most one)", () => {
    const first = addOrReplaceLayer([], { kind: "full", file: fakeFile("a.mp4") });
    const second = addOrReplaceLayer(
      first.layers,
      { kind: "full", file: fakeFile("b.mp4") },
      first.files,
    );
    expect(second.layers).toHaveLength(1);
    expect(second.layers[0]!.id).not.toBe(first.layers[0]!.id);
    expect(second.files.has(first.layers[0]!.fileId)).toBe(false);
  });

  it("adds overlay layer ready immediately (no matting state)", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    expect(r.layers[0]!.kind).toBe("overlay");
    expect(r.layers[0]!.tag).toBe(OVERLAY_LAYER_TAG);
  });

  it("full and overlay coexist independently", () => {
    const r1 = addOrReplaceLayer([], { kind: "full", file: fakeFile() });
    const r2 = addOrReplaceLayer(r1.layers, { kind: "overlay", file: fakeFile() }, r1.files);
    expect(r2.layers).toHaveLength(2);
    expect(getLayerByKind(r2.layers, "full")).toBeDefined();
    expect(getLayerByKind(r2.layers, "overlay")).toBeDefined();
  });
});

describe("removeLayer", () => {
  it("removes the layer and its file", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const after = removeLayer(r.layers, r.layers[0]!.id, r.files);
    expect(after.layers).toHaveLength(0);
    expect(after.files.size).toBe(0);
  });
});

describe("findLayerByTag", () => {
  it("matches lowercased tag", () => {
    const r = addOrReplaceLayer([], { kind: "full", file: fakeFile() });
    expect(findLayerByTag(r.layers, FULL_LAYER_TAG.toUpperCase())?.tag).toBe(FULL_LAYER_TAG);
    expect(findLayerByTag(r.layers, "missing")).toBeUndefined();
  });
});
