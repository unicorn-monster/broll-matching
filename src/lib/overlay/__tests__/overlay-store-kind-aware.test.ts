import { describe, it, expect } from "vitest";
import {
  compactTracks,
  addOverlayWithNewTrack,
  splitOverlayAtMs,
} from "../overlay-store";
import type { OverlayItem } from "../overlay-types";

const broll = (id: string, trackIndex: number): OverlayItem => ({
  id,
  kind: "broll-video",
  trackIndex,
  startMs: 0,
  durationMs: 1000,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c1",
  fileId: "f1",
  sourceStartMs: 0,
  sourceDurationMs: 1000,
});

const text = (id: string): OverlayItem => ({
  id,
  kind: "text",
  trackIndex: 0,
  startMs: 0,
  durationMs: 1000,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  text: "hi",
  source: "manual",
  fontFamily: "Inter",
  fontWeight: 700,
  fontSizeFrac: 0.05,
  textColor: "#000",
  bgMode: "per-line",
  bgColor: "#fff",
  bgOpacity: 1,
  bgPaddingXFrac: 0.015,
  bgPaddingYFrac: 0.008,
  bgRadiusFrac: 0.5,
  strokeEnabled: false,
  strokeColor: "#000",
  strokeWidthFrac: 0.003,
  alignment: "center",
  positionXFrac: 0.5,
  positionYFrac: 0.85,
  maxWidthFrac: 0.8,
});

describe("compactTracks — kind-aware", () => {
  it("compacts only broll-video trackIndices and leaves text overlays untouched", () => {
    const result = compactTracks([broll("a", 2), broll("b", 5), text("t1")]);
    const a = result.find((o) => o.id === "a")!;
    const b = result.find((o) => o.id === "b")!;
    const t = result.find((o) => o.id === "t1")!;
    expect(a.trackIndex).toBe(0);
    expect(b.trackIndex).toBe(1);
    expect(t.trackIndex).toBe(0);
    expect(t.kind).toBe("text");
  });
});

describe("addOverlayWithNewTrack — kind-aware", () => {
  it("only shifts broll-video items when inserting a new broll overlay", () => {
    const next = broll("new", 1);
    const result = addOverlayWithNewTrack([broll("a", 1), text("t1")], next);
    const a = result.find((o) => o.id === "a")!;
    const t = result.find((o) => o.id === "t1")!;
    expect(a.trackIndex).toBe(2);
    expect(t.trackIndex).toBe(0);
  });
});

describe("splitOverlayAtMs — kind-aware", () => {
  it("returns overlays unchanged when split target is a text overlay", () => {
    const overlays = [text("t1"), broll("a", 0)];
    expect(splitOverlayAtMs(overlays, "t1", 500)).toEqual(overlays);
  });
});
