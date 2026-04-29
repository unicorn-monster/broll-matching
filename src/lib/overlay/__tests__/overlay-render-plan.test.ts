import { describe, it, expect } from "vitest";
import { findActiveOverlays, findTopmostActive, computeFadedVolume } from "../overlay-render-plan";
import type { BrollVideoOverlay } from "../overlay-types";

const make = (
  id: string,
  startMs: number,
  durationMs: number,
  trackIndex = 0,
  partial: Partial<BrollVideoOverlay> = {},
): BrollVideoOverlay => ({
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
  indexeddbKey: "k",
  sourceStartMs: 0,
  sourceDurationMs: durationMs,
  ...partial,
});

describe("findActiveOverlays", () => {
  it("returns overlays whose [start, start+dur) contains ms", () => {
    const a = make("a", 1000, 2000);
    const b = make("b", 2500, 1000, 1);
    const out = findActiveOverlays([a, b], 2700);
    expect(out.map((o) => o.id).sort()).toEqual(["a", "b"]);
  });
  it("excludes overlay at exact end (half-open interval)", () => {
    const a = make("a", 1000, 1000); // 1000-2000
    expect(findActiveOverlays([a], 2000)).toEqual([]);
  });
});

describe("findTopmostActive", () => {
  it("picks highest trackIndex among active", () => {
    const a = make("a", 1000, 2000, 0);
    const b = make("b", 1000, 2000, 2);
    const c = make("c", 1000, 2000, 1);
    expect(findTopmostActive([a, b, c], 1500)?.id).toBe("b");
  });
  it("returns null when none active", () => {
    expect(findTopmostActive([make("a", 0, 1000)], 5000)).toBe(null);
  });
});

describe("computeFadedVolume", () => {
  it("returns volume*1 when no fades", () => {
    const o = make("a", 1000, 2000, 0, { volume: 0.8 });
    expect(computeFadedVolume(o, 1500)).toBeCloseTo(0.8);
  });
  it("ramps from 0 to volume during fadeIn", () => {
    const o = make("a", 1000, 2000, 0, { volume: 1, fadeInMs: 1000 });
    expect(computeFadedVolume(o, 1000)).toBeCloseTo(0);
    expect(computeFadedVolume(o, 1500)).toBeCloseTo(0.5);
    expect(computeFadedVolume(o, 2000)).toBeCloseTo(1);
  });
  it("ramps from volume to 0 during fadeOut", () => {
    const o = make("a", 1000, 2000, 0, { volume: 1, fadeOutMs: 500 });
    // fadeOut starts at localMs > durationMs - fadeOutMs = 1500
    expect(computeFadedVolume(o, 2500)).toBeCloseTo(1); // localMs=1500, not yet fading
    expect(computeFadedVolume(o, 2750)).toBeCloseTo(0.5);
    expect(computeFadedVolume(o, 2999)).toBeCloseTo(0.002, 2);
  });
  it("clamps result to 0..1 (HTMLMediaElement range)", () => {
    const o = make("a", 1000, 2000, 0, { volume: 2 });
    expect(computeFadedVolume(o, 1500)).toBe(1);
  });
  it("returns volume when muted=true — caller handles muted via el.muted", () => {
    const o = make("a", 1000, 2000, 0, { volume: 1, muted: true });
    expect(computeFadedVolume(o, 1500)).toBe(1);
  });
});
