import { describe, expect, it } from "vitest";
import { canMatte } from "../browser-support";

describe("canMatte", () => {
  it("returns false when VideoEncoder is missing", () => {
    expect(canMatte({ hasVideoEncoder: false, isMobile: false })).toEqual({ ok: false, reason: "no-webcodecs" });
  });
  it("returns false on mobile chromium", () => {
    expect(canMatte({ hasVideoEncoder: true, isMobile: true })).toEqual({ ok: false, reason: "mobile-not-supported" });
  });
  it("returns ok when both present and desktop", () => {
    expect(canMatte({ hasVideoEncoder: true, isMobile: false })).toEqual({ ok: true });
  });
});
