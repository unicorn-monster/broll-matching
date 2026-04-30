import { describe, it, expect } from "vitest";
import { isOverlapOnSameTrack } from "../overlay-collision";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (id: string, trackIndex: number, startMs: number, durationMs: number): BrollVideoOverlay => ({
  id,
  kind: "broll-video",
  trackIndex,
  startMs,
  durationMs,
  volume: 1,
  muted: false,
  fadeInMs: 0,
  fadeOutMs: 0,
  clipId: "c",
  fileId: "k",
  sourceStartMs: 0,
  sourceDurationMs: durationMs,
});

describe("isOverlapOnSameTrack", () => {
  it("returns false when no overlays on track", () => {
    expect(isOverlapOnSameTrack([], { trackIndex: 0, startMs: 0, durationMs: 1000 })).toBe(false);
  });

  it("returns true on partial overlap", () => {
    const a = make("a", 0, 1000, 2000); // 1000-3000
    const target = { trackIndex: 0, startMs: 2000, durationMs: 2000 }; // 2000-4000
    expect(isOverlapOnSameTrack([a], target)).toBe(true);
  });

  it("returns false when target is exactly adjacent (touches edge)", () => {
    const a = make("a", 0, 1000, 1000); // 1000-2000
    const target = { trackIndex: 0, startMs: 2000, durationMs: 1000 }; // 2000-3000
    expect(isOverlapOnSameTrack([a], target)).toBe(false);
  });

  it("returns false when on different track", () => {
    const a = make("a", 0, 1000, 2000);
    const target = { trackIndex: 1, startMs: 1500, durationMs: 1000 };
    expect(isOverlapOnSameTrack([a], target)).toBe(false);
  });

  it("ignores self when idToIgnore is set", () => {
    const a = make("a", 0, 1000, 2000);
    const target = { trackIndex: 0, startMs: 1500, durationMs: 1000, idToIgnore: "a" };
    expect(isOverlapOnSameTrack([a], target)).toBe(false);
  });

  it("returns true when target fully contains existing", () => {
    const a = make("a", 0, 2000, 1000); // 2000-3000
    const target = { trackIndex: 0, startMs: 1000, durationMs: 3000 }; // 1000-4000
    expect(isOverlapOnSameTrack([a], target)).toBe(true);
  });
});
