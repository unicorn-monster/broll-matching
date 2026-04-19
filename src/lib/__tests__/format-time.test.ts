import { describe, it, expect } from "vitest";
import { formatMs } from "../format-time";

describe("formatMs", () => {
  it("formats zero", () => expect(formatMs(0)).toBe("0:00.000"));
  it("formats sub-second", () => expect(formatMs(250)).toBe("0:00.250"));
  it("formats with minutes", () => expect(formatMs(65_500)).toBe("1:05.500"));
  it("formats frame-aligned ms", () => expect(formatMs(1833.3333)).toBe("0:01.833"));
});
