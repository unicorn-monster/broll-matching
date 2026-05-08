import { describe, it, expect } from "vitest";
import { msToFrames, framesToMs, snapMsToFrame } from "../frame-align";

describe("frame-align @ 30fps", () => {
  it("msToFrames rounds to nearest frame", () => {
    expect(msToFrames(0)).toBe(0);
    expect(msToFrames(33)).toBe(1);   // 33 / 33.333 = 0.99 → 1
    expect(msToFrames(34)).toBe(1);
    expect(msToFrames(50)).toBe(2);   // 50 / 33.333 = 1.5 → round to 2
    expect(msToFrames(1000)).toBe(30);
    expect(msToFrames(1833)).toBe(55); // 1.833s ≈ 55 frames
  });

  it("framesToMs produces exact frame timestamps", () => {
    expect(framesToMs(0)).toBe(0);
    expect(framesToMs(1)).toBeCloseTo(33.3333, 3);
    expect(framesToMs(30)).toBe(1000);
    expect(framesToMs(55)).toBeCloseTo(1833.3333, 3);
  });

  it("snapMsToFrame returns exact frame-aligned ms", () => {
    expect(snapMsToFrame(0)).toBe(0);
    expect(snapMsToFrame(1833)).toBeCloseTo(1833.3333, 3);
    // 1833ms is closer to frame 55 (1833.33ms) than frame 54 (1800ms)
    expect(snapMsToFrame(1800)).toBe(1800);
  });

  it("accepts custom fps", () => {
    expect(msToFrames(1000, 60)).toBe(60);
    expect(framesToMs(60, 60)).toBe(1000);
  });
});
