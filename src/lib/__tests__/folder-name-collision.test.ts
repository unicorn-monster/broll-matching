import { describe, it, expect } from "vitest";
import { resolveCollidingFolderName } from "@/lib/folder-name-collision";

describe("resolveCollidingFolderName", () => {
  it("returns base name unchanged when no collision", () => {
    expect(resolveCollidingFolderName("hook", ["other"])).toBe("hook");
  });

  it("appends (2) on first collision", () => {
    expect(resolveCollidingFolderName("hook", ["hook"])).toBe("hook (2)");
  });

  it("walks to (3) when (2) also exists", () => {
    expect(resolveCollidingFolderName("hook", ["hook", "hook (2)"])).toBe("hook (3)");
  });

  it("ignores unrelated parenthesized names", () => {
    expect(resolveCollidingFolderName("hook", ["hook", "intro (2)"])).toBe("hook (2)");
  });

  it("handles names that already end in (n) literally", () => {
    expect(resolveCollidingFolderName("hook (2)", ["hook (2)"])).toBe("hook (2) (2)");
  });
});
