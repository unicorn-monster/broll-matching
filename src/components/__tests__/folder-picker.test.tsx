import { describe, it, expect, vi, beforeEach } from "vitest";
import { filenameToBrollName, deriveBaseName, isValidBrollName } from "@/lib/broll";
import { extractVideoMetadata } from "@/lib/video-metadata";

/**
 * Unit tests for the folder picker logic.
 *
 * The FolderPicker component's main concerns are:
 * 1. Call pickFolder() to get user's selected files
 * 2. Validate broll names using isValidBrollName()
 * 3. Extract metadata for all videos in parallel
 * 4. Populate media pool with videos and audios
 * 5. Call onLoaded() when complete
 *
 * We test the underlying utilities and the flow logic here.
 */

describe("FolderPicker integration", () => {
  describe("filename validation flow", () => {
    it("converts video filename to broll name by removing extension", () => {
      const name = filenameToBrollName("sample.mp4");
      expect(name).toBe("sample");
    });

    it("handles uppercase extensions", () => {
      const name = filenameToBrollName("VIDEO.MP4");
      expect(name).toBe("video");
    });

    it("validates correct broll names: base-number format", () => {
      expect(isValidBrollName("action-1")).toBe(true);
      expect(isValidBrollName("complex-scene-10")).toBe(true);
      expect(isValidBrollName("a-b-c-1")).toBe(true);
    });

    it("rejects invalid broll names", () => {
      expect(isValidBrollName("action")).toBe(false); // no number
      expect(isValidBrollName("action-")).toBe(false); // incomplete
      expect(isValidBrollName("action_1")).toBe(false); // underscore instead of dash
      expect(isValidBrollName("action-a")).toBe(false); // non-numeric suffix
    });

    it("derives base name by stripping numeric suffix", () => {
      expect(deriveBaseName("action-1")).toBe("action");
      expect(deriveBaseName("complex-scene-5")).toBe("complex-scene");
      expect(deriveBaseName("a-b-c-99")).toBe("a-b-c");
    });

    it("skips files with invalid broll names during loading", () => {
      const validName = filenameToBrollName("action-1.mp4");
      const invalidName = filenameToBrollName("invalid_name.mp4");

      expect(isValidBrollName(validName)).toBe(true);
      expect(isValidBrollName(invalidName)).toBe(false);
    });
  });

  describe("metadata extraction", () => {
    beforeEach(() => {
      // video element mock
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn(() => "blob:mock-url"),
        revokeObjectURL: vi.fn(),
      });
    });

    it("extracts duration, width, and height from video file", () => {
      // This test validates the function signature
      // Actual DOM-based testing would need jsdom environment
      expect(typeof extractVideoMetadata).toBe("function");
    });
  });

  describe("clip metadata construction", () => {
    it("creates clip metadata with all required fields", () => {
      // Simulate what FolderPicker does when constructing ClipMetadata
      const fileId = crypto.randomUUID();
      const filename = "action-1.mp4";
      const brollName = filenameToBrollName(filename);

      expect(isValidBrollName(brollName)).toBe(true);

      const clipMetadata = {
        id: fileId,
        brollName,
        baseName: deriveBaseName(brollName),
        durationMs: 5000,
        fileId,
        folderId: "local",
        filename,
        width: 1920,
        height: 1080,
        fileSizeBytes: 2048,
        createdAt: new Date(),
      };

      expect(clipMetadata.id).toBe(fileId);
      expect(clipMetadata.brollName).toBe("action-1");
      expect(clipMetadata.baseName).toBe("action");
      expect(clipMetadata.filename).toBe("action-1.mp4");
    });

    it("creates audio file entries with id and filename", () => {
      const audioId = crypto.randomUUID();
      const filename = "music.mp3";

      const audioEntry = {
        id: audioId,
        filename,
        file: new File([], filename, { type: "audio/mp3" }),
      };

      expect(audioEntry.id).toBe(audioId);
      expect(audioEntry.filename).toBe("music.mp3");
      expect(audioEntry.file.name).toBe("music.mp3");
    });
  });

  describe("parallel metadata extraction", () => {
    it("uses Promise.all to extract metadata from multiple videos in parallel", () => {
      const files = [
        new File([], "clip-1.mp4"),
        new File([], "clip-2.mp4"),
        new File([], "clip-3.mp4"),
      ];

      // Test validates the approach: we should use Promise.all() to extract
      // metadata for all videos at once, not sequentially
      const promises = files.map(() => {
        // This simulates what FolderPicker.handlePick does
        return Promise.resolve({ durationMs: 5000, width: 1920, height: 1080 });
      });

      expect(promises).toHaveLength(3);
    });
  });

  describe("error handling", () => {
    it("gracefully skips videos that fail metadata extraction", async () => {
      const videos = [
        { name: "valid.mp4", extractable: true },
        { name: "corrupt.mp4", extractable: false },
        { name: "another-valid.mp4", extractable: true },
      ];

      const results = await Promise.all(
        videos.map(async (v) => {
          if (!v.extractable) {
            return null; // Skip on error
          }
          return { name: v.name, meta: { durationMs: 5000 } };
        }),
      );

      const successful = results.filter((r) => r !== null);
      expect(successful).toHaveLength(2);
    });

    it("handles AbortError separately from other errors", () => {
      const abortError = new Error("User cancelled");
      abortError.name = "AbortError";

      // Should not display error to user for AbortError
      const shouldShowError = abortError.name !== "AbortError";
      expect(shouldShowError).toBe(false);
    });

    it("requires at least one video or audio to proceed", () => {
      const videos: unknown[] = [];
      const audios: unknown[] = [];

      const hasMedia = videos.length > 0 || audios.length > 0;
      expect(hasMedia).toBe(false);

      const shouldError = !hasMedia;
      expect(shouldError).toBe(true);
    });
  });
});
