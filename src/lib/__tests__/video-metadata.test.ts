// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractVideoMetadata } from "../video-metadata";

describe("extractVideoMetadata", () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => "blob:fake");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("resolves with duration, width, height when video loads", async () => {
    const fakeFile = new File(["fake"], "clip.mp4", { type: "video/mp4" });

    Object.defineProperty(global.HTMLVideoElement.prototype, "src", {
      configurable: true,
      set(this: HTMLVideoElement) {
        Object.defineProperty(this, "duration", { value: 4.5, configurable: true });
        Object.defineProperty(this, "videoWidth", { value: 1920, configurable: true });
        Object.defineProperty(this, "videoHeight", { value: 1080, configurable: true });
        queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
      },
    });

    const meta = await extractVideoMetadata(fakeFile);
    expect(meta).toEqual({ durationMs: 4500, width: 1920, height: 1080 });
  });

  it("rejects when video fails to load", async () => {
    const fakeFile = new File(["bad"], "bad.mp4", { type: "video/mp4" });
    Object.defineProperty(global.HTMLVideoElement.prototype, "src", {
      configurable: true,
      set(this: HTMLVideoElement) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      },
    });

    await expect(extractVideoMetadata(fakeFile)).rejects.toThrow();
  });
});
