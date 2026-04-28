// src/lib/overlay/__tests__/overlay-store.test.ts
import { describe, it, expect } from "vitest";
import {
  addOverlay,
  addOverlayWithNewTrack,
  removeOverlay,
  moveOverlay,
  splitOverlayAtMs,
  mutateOverlay,
  compactTracks,
} from "../overlay-store";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (overrides: Partial<BrollVideoOverlay> = {}): BrollVideoOverlay => ({
  id: overrides.id ?? "o1",
  kind: "broll-video",
  trackIndex: 0,
  startMs: 0,
  durationMs: 1000,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c1",
  indexeddbKey: "k1",
  sourceStartMs: 0,
  sourceDurationMs: 1000,
  ...overrides,
});

describe("addOverlay", () => {
  it("appends an overlay to the list", () => {
    const a = make({ id: "a" });
    const b = make({ id: "b", trackIndex: 1 });
    expect(addOverlay([a], b)).toEqual([a, b]);
  });
});

describe("addOverlayWithNewTrack", () => {
  it("shifts existing tracks >= target up by 1, then inserts", () => {
    const a = make({ id: "a", trackIndex: 0 });
    const b = make({ id: "b", trackIndex: 1 });
    const inserted = make({ id: "c", trackIndex: 1 });
    const out = addOverlayWithNewTrack([a, b], inserted);
    expect(out.find((o) => o.id === "a")?.trackIndex).toBe(0);
    expect(out.find((o) => o.id === "b")?.trackIndex).toBe(2);
    expect(out.find((o) => o.id === "c")?.trackIndex).toBe(1);
  });
});

describe("removeOverlay", () => {
  it("removes overlay by id", () => {
    const a = make({ id: "a" });
    const b = make({ id: "b" });
    expect(removeOverlay([a, b], "a")).toEqual([b]);
  });
});

describe("moveOverlay", () => {
  it("updates startMs and trackIndex of one overlay", () => {
    const a = make({ id: "a", startMs: 1000, trackIndex: 0 });
    const out = moveOverlay([a], "a", { startMs: 2000, trackIndex: 1 });
    expect(out[0]).toMatchObject({ id: "a", startMs: 2000, trackIndex: 1 });
  });
  it("no-op when id missing", () => {
    const a = make({ id: "a" });
    expect(moveOverlay([a], "missing", { startMs: 5000, trackIndex: 0 })).toEqual([a]);
  });
});

describe("splitOverlayAtMs", () => {
  it("splits an overlay into two adjacent pieces", () => {
    const a = make({ id: "a", startMs: 1000, durationMs: 4000, sourceStartMs: 500 });
    const out = splitOverlayAtMs([a], "a", 3000);
    expect(out).toHaveLength(2);
    const left = out.find((o) => o.id === "a");
    const right = out.find((o) => o.id !== "a");
    expect(left).toMatchObject({ startMs: 1000, durationMs: 2000, sourceStartMs: 500 });
    expect(right).toMatchObject({ startMs: 3000, durationMs: 2000, sourceStartMs: 2500 });
  });
  it("no-op when playhead is outside overlay range", () => {
    const a = make({ id: "a", startMs: 1000, durationMs: 1000 });
    expect(splitOverlayAtMs([a], "a", 500)).toEqual([a]);
    expect(splitOverlayAtMs([a], "a", 2500)).toEqual([a]);
  });
  it("no-op when playhead is exactly at start or end", () => {
    const a = make({ id: "a", startMs: 1000, durationMs: 1000 });
    expect(splitOverlayAtMs([a], "a", 1000)).toEqual([a]);
    expect(splitOverlayAtMs([a], "a", 2000)).toEqual([a]);
  });
});

describe("mutateOverlay", () => {
  it("merges patch into the overlay with given id", () => {
    const a = make({ id: "a", volume: 1, muted: false });
    const out = mutateOverlay([a], "a", { volume: 0.5, muted: true });
    expect(out[0]).toMatchObject({ volume: 0.5, muted: true });
  });
});

describe("compactTracks", () => {
  it("removes gaps in trackIndex sequence", () => {
    const a = make({ id: "a", trackIndex: 0 });
    const b = make({ id: "b", trackIndex: 2 }); // gap at 1
    const c = make({ id: "c", trackIndex: 5 });
    const out = compactTracks([a, b, c]);
    expect(out.find((o) => o.id === "a")?.trackIndex).toBe(0);
    expect(out.find((o) => o.id === "b")?.trackIndex).toBe(1);
    expect(out.find((o) => o.id === "c")?.trackIndex).toBe(2);
  });
  it("leaves contiguous tracks unchanged", () => {
    const a = make({ id: "a", trackIndex: 0 });
    const b = make({ id: "b", trackIndex: 1 });
    expect(compactTracks([a, b])).toEqual([a, b]);
  });
});
