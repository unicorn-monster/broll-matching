import { describe, it, expect } from "vitest";
import {
  generateFromSections,
  mergeCaptions,
  addManualTextOverlay,
  applyStyleToAll,
  snapToNeighbor,
} from "../text-overlay-store";
import { DEFAULT_TEXT_STYLE } from "../text-style-defaults";
import type { OverlayItem, TextOverlay } from "@/lib/overlay/overlay-types";
import type { ParsedSection } from "@/lib/script-parser";

function section(line: number, text: string, startMs: number, endMs: number): ParsedSection {
  return {
    lineNumber: line,
    startTime: startMs / 1000,
    endTime: endMs / 1000,
    tag: "tag",
    scriptText: text,
    durationMs: endMs - startMs,
  };
}

describe("generateFromSections", () => {
  it("creates one TextOverlay per section with non-empty scriptText", () => {
    const sections = [
      section(1, "hello", 0, 1000),
      section(2, "", 1000, 2000), // skipped
      section(3, "world", 2000, 3000),
    ];
    const out = generateFromSections(sections, DEFAULT_TEXT_STYLE);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("text");
    expect((out[0] as TextOverlay).text).toBe("hello");
    expect((out[0] as TextOverlay).sectionLineNumber).toBe(1);
    expect((out[0] as TextOverlay).source).toBe("auto-script");
    expect(out[0]!.startMs).toBe(0);
    expect(out[0]!.durationMs).toBe(1000);
    expect((out[1] as TextOverlay).text).toBe("world");
  });
});

describe("mergeCaptions", () => {
  const existing: OverlayItem[] = [
    {
      ...DEFAULT_TEXT_STYLE,
      id: "x", kind: "text", trackIndex: 0,
      startMs: 0, durationMs: 1000, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
      text: "user edited!", source: "auto-script", sectionLineNumber: 1,
    } as TextOverlay,
    {
      ...DEFAULT_TEXT_STYLE,
      id: "y", kind: "text", trackIndex: 0,
      startMs: 5000, durationMs: 1000, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
      text: "manual", source: "manual",
    } as TextOverlay,
  ];

  it("'replace' replaces all auto-script overlays but keeps manual ones", () => {
    const sections = [section(1, "regenerated", 0, 1000)];
    const result = mergeCaptions(existing, sections, DEFAULT_TEXT_STYLE, "replace");
    const auto = result.filter((o) => o.kind === "text" && (o as TextOverlay).source === "auto-script");
    const manuals = result.filter((o) => o.kind === "text" && (o as TextOverlay).source === "manual");
    expect(auto).toHaveLength(1);
    expect((auto[0] as TextOverlay).text).toBe("regenerated");
    expect(manuals).toHaveLength(1);
    expect((manuals[0] as TextOverlay).id).toBe("y");
  });

  it("'merge' keeps existing auto overlays by sectionLineNumber, adds new sections", () => {
    const sections = [
      section(1, "regenerated", 0, 1000),
      section(2, "new section", 2000, 3000),
    ];
    const result = mergeCaptions(existing, sections, DEFAULT_TEXT_STYLE, "merge");
    const auto = result.filter((o) => o.kind === "text" && (o as TextOverlay).source === "auto-script") as TextOverlay[];
    expect(auto).toHaveLength(2);
    const kept = auto.find((o) => o.sectionLineNumber === 1)!;
    expect(kept.text).toBe("user edited!"); // preserved
    expect(kept.id).toBe("x"); // same id
    const added = auto.find((o) => o.sectionLineNumber === 2)!;
    expect(added.text).toBe("new section");
  });
});

describe("addManualTextOverlay", () => {
  it("inserts at playhead with default 2000ms duration and provided style", () => {
    const result = addManualTextOverlay([], 5000, DEFAULT_TEXT_STYLE);
    const t = result[0] as TextOverlay;
    expect(t.startMs).toBe(5000);
    expect(t.durationMs).toBe(2000);
    expect(t.source).toBe("manual");
    expect(t.text).toBe("");
  });
});

describe("applyStyleToAll", () => {
  it("propagates style+position fields to all text overlays without touching text or timing", () => {
    const overlays: OverlayItem[] = [
      { ...DEFAULT_TEXT_STYLE, id: "a", kind: "text", trackIndex: 0, startMs: 0, durationMs: 1000, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, text: "A", source: "auto-script", sectionLineNumber: 1 } as TextOverlay,
      { ...DEFAULT_TEXT_STYLE, id: "b", kind: "text", trackIndex: 0, startMs: 2000, durationMs: 1000, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, text: "B", source: "manual" } as TextOverlay,
    ];
    const next = applyStyleToAll(overlays, { textColor: "#ff0000", positionYFrac: 0.5 });
    const a = next[0] as TextOverlay;
    const b = next[1] as TextOverlay;
    expect(a.textColor).toBe("#ff0000");
    expect(b.textColor).toBe("#ff0000");
    expect(a.positionYFrac).toBe(0.5);
    expect(b.positionYFrac).toBe(0.5);
    expect(a.text).toBe("A"); // unchanged
    expect(b.text).toBe("B");
    expect(a.startMs).toBe(0); // timing untouched
  });
});

describe("snapToNeighbor", () => {
  const others: TextOverlay[] = [
    { ...DEFAULT_TEXT_STYLE, id: "left", kind: "text", trackIndex: 0, startMs: 0, durationMs: 1000, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, text: "L", source: "manual" } as TextOverlay,
    { ...DEFAULT_TEXT_STYLE, id: "right", kind: "text", trackIndex: 0, startMs: 3000, durationMs: 1000, volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0, text: "R", source: "manual" } as TextOverlay,
  ];

  it("clamps a moved interval that would overlap the right neighbor", () => {
    const moved = snapToNeighbor({ startMs: 2500, durationMs: 1000 }, "self", others);
    expect(moved.startMs + moved.durationMs).toBeLessThanOrEqual(3000);
    expect(moved.startMs).toBe(2000); // pushed left so end == 3000
  });

  it("clamps a moved interval that would overlap the left neighbor", () => {
    const moved = snapToNeighbor({ startMs: 500, durationMs: 1000 }, "self", others);
    // 'left' ends at 1000; moved start clamped to 1000 keeps duration intact.
    expect(moved.startMs).toBe(1000);
  });

  it("does not clamp when no overlap", () => {
    const moved = snapToNeighbor({ startMs: 1500, durationMs: 500 }, "self", others);
    expect(moved.startMs).toBe(1500);
  });
});
