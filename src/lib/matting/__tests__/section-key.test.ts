import { describe, expect, it } from "vitest";
import { sectionKey, pruneStaleKeys } from "../section-key";

describe("sectionKey", () => {
  it("is stable across reorders, derived from startMs and endMs", () => {
    expect(sectionKey({ startMs: 30000, endMs: 45000 })).toBe("30000-45000");
  });
});

describe("pruneStaleKeys", () => {
  it("keeps only keys that still match a parsed section", () => {
    const live = new Set(["30000-45000", "60000-75000"]);
    const result = pruneStaleKeys(live, [
      { startMs: 30000, endMs: 45000 },
      { startMs: 100000, endMs: 110000 },
    ]);
    expect(result).toEqual(new Set(["30000-45000"]));
  });
});
