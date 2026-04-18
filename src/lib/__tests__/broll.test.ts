import { describe, it, expect } from "vitest";
import {
  deriveBaseName,
  isValidBrollName,
  filenameToBrollName,
  BROLL_NAME_PATTERN,
} from "../broll";

describe("deriveBaseName", () => {
  it("strips numeric suffix", () => {
    expect(deriveBaseName("fs-dremel-loadnshake-01")).toBe("fs-dremel-loadnshake");
  });
  it("strips multi-digit suffix", () => {
    expect(deriveBaseName("hook-12")).toBe("hook");
  });
  it("strips single-digit suffix", () => {
    expect(deriveBaseName("hook-1")).toBe("hook");
  });
  it("does not strip non-numeric trailing segment", () => {
    expect(deriveBaseName("product-in-use-labrador")).toBe("product-in-use-labrador");
  });
  it("handles name with no dash", () => {
    expect(deriveBaseName("hook01")).toBe("hook01");
  });
});

describe("isValidBrollName", () => {
  it("accepts valid name", () => {
    expect(isValidBrollName("fs-dremel-loadnshake-01")).toBe(true);
  });
  it("accepts single-segment base", () => {
    expect(isValidBrollName("hook-01")).toBe(true);
  });
  it("rejects uppercase", () => {
    expect(isValidBrollName("FS-dremel-01")).toBe(false);
  });
  it("rejects missing numeric suffix", () => {
    expect(isValidBrollName("fs-dremel-loadnshake")).toBe(false);
  });
  it("rejects non-numeric suffix", () => {
    expect(isValidBrollName("product-labrador")).toBe(false);
  });
  it("rejects spaces", () => {
    expect(isValidBrollName("fs dremel-01")).toBe(false);
  });
  it("rejects special chars", () => {
    expect(isValidBrollName("fs_dremel-01")).toBe(false);
  });
});

describe("filenameToBrollName", () => {
  it("strips .mp4 and lowercases", () => {
    expect(filenameToBrollName("FS-Dremel-LoadNShake-01.mp4")).toBe("fs-dremel-loadnshake-01");
  });
  it("handles uppercase .MP4", () => {
    expect(filenameToBrollName("Hook-01.MP4")).toBe("hook-01");
  });
  it("file already lowercase", () => {
    expect(filenameToBrollName("hook-01.mp4")).toBe("hook-01");
  });
});
