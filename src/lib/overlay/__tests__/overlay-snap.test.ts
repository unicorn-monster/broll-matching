import { describe, it, expect } from "vitest";
import { computeSnap, type SnapCandidate } from "../overlay-snap";

const c = (ms: number, kind: SnapCandidate["kind"]): SnapCandidate => ({ ms, kind });

describe("computeSnap", () => {
  it("returns rawStartMs unchanged when no candidate is within threshold", () => {
    const out = computeSnap(5000, [c(100, "playhead")], 100, 10); // 5s away
    expect(out.snappedStartMs).toBe(5000);
    expect(out.snapTarget).toBe(null);
  });

  it("snaps to playhead when within 10px", () => {
    // pxPerSec = 100, threshold = 10px → 100ms threshold in time
    const out = computeSnap(1050, [c(1000, "playhead")], 100, 10);
    expect(out.snappedStartMs).toBe(1000);
    expect(out.snapTarget).toBe("playhead");
  });

  it("snaps to closer candidate when multiple within threshold", () => {
    const candidates = [c(900, "edge"), c(1100, "edge")];
    const out = computeSnap(1050, candidates, 100, 10);
    expect(out.snappedStartMs).toBe(1100);
    expect(out.snapTarget).toBe("edge");
  });

  it("priority: playhead > section > edge > zero on tie within threshold", () => {
    const candidates = [c(1000, "edge"), c(1000, "playhead"), c(1000, "section")];
    const out = computeSnap(1050, candidates, 100, 10);
    expect(out.snapTarget).toBe("playhead");
  });

  it("snaps to zero when raw is near 0", () => {
    const out = computeSnap(50, [c(0, "zero")], 100, 10); // 50ms from 0 = 5px → within threshold
    expect(out.snappedStartMs).toBe(0);
    expect(out.snapTarget).toBe("zero");
  });

  it("threshold is in pixel space, not ms", () => {
    // pxPerSec = 1000 → 10px threshold = 10ms in time
    // raw = 108, candidate at 100 → 8ms = 8px → within → snaps
    const out = computeSnap(108, [c(100, "playhead")], 1000, 10);
    expect(out.snappedStartMs).toBe(100);
    expect(out.snapTarget).toBe("playhead");
  });
});
