import { describe, expect, it } from "vitest";
import {
  addOrReplaceLayer,
  findLayerByTag,
  getLayerByKind,
  removeLayer,
  setMattingProgress,
  setMattingStatus,
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

  it("adds overlay layer with mattingStatus='processing'", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    expect(r.layers[0]!.kind).toBe("overlay");
    expect(r.layers[0]!.tag).toBe(OVERLAY_LAYER_TAG);
    expect(r.layers[0]!.mattingStatus).toBe("processing");
  });

  it("full and overlay coexist independently", () => {
    const r1 = addOrReplaceLayer([], { kind: "full", file: fakeFile() });
    const r2 = addOrReplaceLayer(r1.layers, { kind: "overlay", file: fakeFile() }, r1.files);
    expect(r2.layers).toHaveLength(2);
    expect(getLayerByKind(r2.layers, "full")).toBeDefined();
    expect(getLayerByKind(r2.layers, "overlay")).toBeDefined();
  });
});

describe("setMattingStatus / setMattingProgress", () => {
  it("transitions overlay layer processing → ready and clears progress", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const id = r.layers[0]!.id;
    const withProgress = setMattingProgress(r.layers, id, { framesDone: 50, totalFrames: 100 });
    expect(getLayerByKind(withProgress, "overlay")!.mattingProgress!.framesDone).toBe(50);

    const ready = setMattingStatus(withProgress, id, "ready", "matted-xyz");
    const overlay = getLayerByKind(ready, "overlay")!;
    expect(overlay.mattingStatus).toBe("ready");
    expect(overlay.mattedFileId).toBe("matted-xyz");
    expect(overlay.mattingProgress).toBeUndefined();
  });

  it("transitions to failed without setting mattedFileId", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const failed = setMattingStatus(r.layers, r.layers[0]!.id, "failed");
    expect(getLayerByKind(failed, "overlay")!.mattingStatus).toBe("failed");
    expect(getLayerByKind(failed, "overlay")!.mattedFileId).toBeUndefined();
  });
});

describe("removeLayer", () => {
  it("removes the layer and its files (both original and matted)", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const ready = setMattingStatus(r.layers, r.layers[0]!.id, "ready", "matted-xyz");
    const filesWithMatted = new Map(r.files);
    filesWithMatted.set("matted-xyz", fakeFile("matted.webm"));

    const after = removeLayer(ready, r.layers[0]!.id, filesWithMatted);
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
