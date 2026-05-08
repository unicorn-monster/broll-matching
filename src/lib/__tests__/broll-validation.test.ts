import { describe, it, expect } from "vitest";
import { validateBrollFile } from "@/lib/broll-validation";

function file(name: string): File {
  return new File([new Uint8Array([0])], name);
}

describe("validateBrollFile", () => {
  it("accepts well-formed lowercase tag-NN.mp4", () => {
    const r = validateBrollFile(file("hook-01.mp4"));
    expect(r).toEqual({ valid: true, brollName: "hook-01" });
  });

  it("accepts multi-segment tag like before-after-12.mov", () => {
    const r = validateBrollFile(file("before-after-12.mov"));
    expect(r).toEqual({ valid: true, brollName: "before-after-12" });
  });

  it("accepts .webm", () => {
    const r = validateBrollFile(file("x-1.webm"));
    expect(r.valid).toBe(true);
  });

  it("rejects non-video extension as 'not a video file'", () => {
    expect(validateBrollFile(file("notes.txt"))).toEqual({
      valid: false,
      reason: "not a video file",
    });
  });

  it("rejects no extension as 'not a video file'", () => {
    expect(validateBrollFile(file("hook-01"))).toEqual({
      valid: false,
      reason: "not a video file",
    });
  });

  it("rejects uppercase as 'must be lowercase, no spaces'", () => {
    expect(validateBrollFile(file("Hook-01.mp4"))).toEqual({
      valid: false,
      reason: "must be lowercase, no spaces",
    });
  });

  it("rejects whitespace as 'must be lowercase, no spaces'", () => {
    expect(validateBrollFile(file("hook 01.mp4"))).toEqual({
      valid: false,
      reason: "must be lowercase, no spaces",
    });
  });

  it("rejects missing -NN as 'must end with -NN'", () => {
    expect(validateBrollFile(file("hook.mp4"))).toEqual({
      valid: false,
      reason: "must end with -NN",
    });
  });

  it("rejects underscore-separated as 'must end with -NN'", () => {
    expect(validateBrollFile(file("hook_01.mp4"))).toEqual({
      valid: false,
      reason: "must end with -NN",
    });
  });
});
