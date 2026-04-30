import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { openMediaDB, deleteMediaDB } from "@/lib/media-storage";

beforeEach(async () => {
  await deleteMediaDB();
});

describe("media-storage", () => {
  it("opens database with all required object stores", async () => {
    const db = await openMediaDB();
    const names = Array.from(db.objectStoreNames).sort();
    expect(names).toEqual(["audio", "clips", "files", "folders", "meta"]);
    db.close();
  });
});
