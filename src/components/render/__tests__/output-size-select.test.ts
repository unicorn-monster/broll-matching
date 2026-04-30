import { describe, it, expect } from "vitest";
import { isValidSize } from "../output-size-select";

describe("isValidSize", () => {
  it("accepts valid size: 1080×1920", () => {
    expect(isValidSize({ width: 1080, height: 1920 })).toBe(true);
  });

  it("accepts valid size: 1920×1080", () => {
    expect(isValidSize({ width: 1920, height: 1080 })).toBe(true);
  });

  it("accepts valid size: minimum bounds 240×240", () => {
    expect(isValidSize({ width: 240, height: 240 })).toBe(true);
  });

  it("accepts valid size: maximum bounds 4096×4096", () => {
    expect(isValidSize({ width: 4096, height: 4096 })).toBe(true);
  });

  it("rejects width below minimum (239)", () => {
    expect(isValidSize({ width: 239, height: 1080 })).toBe(false);
  });

  it("rejects width above maximum (4097)", () => {
    expect(isValidSize({ width: 4097, height: 1080 })).toBe(false);
  });

  it("rejects height below minimum (239)", () => {
    expect(isValidSize({ width: 1080, height: 239 })).toBe(false);
  });

  it("rejects height above maximum (4097)", () => {
    expect(isValidSize({ width: 1080, height: 4097 })).toBe(false);
  });

  it("rejects odd width (1081)", () => {
    expect(isValidSize({ width: 1081, height: 1080 })).toBe(false);
  });

  it("rejects odd height (1081)", () => {
    expect(isValidSize({ width: 1080, height: 1081 })).toBe(false);
  });

  it("rejects both odd dimensions", () => {
    expect(isValidSize({ width: 1081, height: 1081 })).toBe(false);
  });
});
