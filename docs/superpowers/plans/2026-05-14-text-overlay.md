# Text Overlay v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add static text-caption overlays to the editor — auto-generated from parsed script (one per section), manually addable, draggable/resizable on a dedicated single-row timeline track, style-editable in a sidebar inspector (with an "Apply to all" toggle), rendered into the preview and burned into the exported MP4 via canvas-PNG → ffmpeg overlay.

**Architecture:**
- `TextOverlay` becomes the second variant of the existing `OverlayItem` discriminated union (`kind: "text"`). Same `BuildState.overlays` array; b-roll-specific store helpers become kind-aware so text overlays never participate in trackIndex compaction or stacking.
- A new pure-logic module under `src/lib/text-overlay/` owns: defaults, auto-generation from `ParsedSection[]`, merge policy, neighbor-snap, and canvas-based PNG rendering (used identically by preview and exporter so output matches preview pixel-for-pixel).
- New UI: dedicated timeline row `<TrackTextOverlays>` (above `TrackTags`), new `<TextOverlayInspector>` (chosen by `editor-shell` when selected overlay's `kind === "text"`), and two toolbar buttons (`Generate captions`, `+ Add text`).
- Export: `render-worker.ts` is extended at the final-mux step to receive a `captions` payload (array of `{pngBytes, startMs, endMs, xPx, yPx}`) and chain `overlay` filters with `enable='between(t,start,end)'`. A new `Include captions` checkbox in the export dialog gates the payload.

**Tech Stack:** TypeScript, React 19 / Next.js 15, Tailwind 4, Vitest, FFmpeg.wasm (`@ffmpeg/ffmpeg`), HTML Canvas 2D, browser FontFace API.

---

## File Structure

**Pure logic (new)**

| File | Responsibility |
|---|---|
| `src/lib/text-overlay/text-overlay-types.ts` | `TextOverlay` type, `TextStyle` type, sticky-pref key |
| `src/lib/text-overlay/text-style-defaults.ts` | `DEFAULT_TEXT_STYLE`, font registry |
| `src/lib/text-overlay/text-overlay-store.ts` | `generateFromSections`, `mergeCaptions`, `addManualTextOverlay`, `applyStyleToAll`, `snapToNeighbor`, `removeTextOverlay` |
| `src/lib/text-overlay/text-overlay-render.ts` | `renderTextOverlayToCanvas`, `renderTextOverlayToPNGBytes`, `wrapTextToLines`, `computeOverlayPixelBox` |
| `src/lib/text-overlay/INDEX.md` | Folder index (matches `src/lib/overlay/INDEX.md` pattern) |

**Pure logic (modified)**

| File | Change |
|---|---|
| `src/lib/overlay/overlay-types.ts` | Add `TextOverlay` to union, keep `BrollVideoOverlay` |
| `src/lib/overlay/overlay-store.ts` | Make `compactTracks` and `addOverlayWithNewTrack` ignore non-`broll-video` items |
| `src/lib/overlay/overlay-render-plan.ts` | `findTopmostActive` / `findActiveOverlays` filter to `broll-video` only |

**UI (new)**

| File | Responsibility |
|---|---|
| `src/components/editor/timeline/track-text-overlays.tsx` | Single-row block strip with drag/resize/select/snap |
| `src/components/editor/overlay/text-overlay-inspector.tsx` | Sidebar form (apply-all, textarea, font, size, color, BG, stroke, position) |
| `src/components/editor/preview/text-overlay-layer.tsx` | Absolute-positioned `<img>` per text overlay inside preview, with drag handle on selection |
| `src/components/editor/toolbar/generate-captions-button.tsx` | Toolbar button + opens dialog |
| `src/components/editor/toolbar/add-text-button.tsx` | Toolbar button |
| `src/components/editor/dialogs/generate-captions-dialog.tsx` | Replace / Merge / Cancel modal |
| `src/components/editor/overlay/INDEX.md` | (Update with new files) |

**UI (modified)**

| File | Change |
|---|---|
| `src/components/build/build-state-context.tsx` | Add `textOverlayApplyAll` + setter, persist to localStorage |
| `src/components/editor/editor-shell.tsx` | Route to `TextOverlayInspector` when selected overlay is `kind === "text"`; mount `GenerateCaptionsButton` + `AddTextButton` in toolbar |
| `src/components/editor/timeline/timeline-panel.tsx` | Insert `<TrackTextOverlays>` between `<TimelineRuler>` and `<TrackTags>` |
| `src/components/editor/preview/preview-player.tsx` | Mount `<TextOverlayLayer>` inside the preview frame |
| `src/components/editor/overlay/use-overlay-keyboard.ts` | Already kind-agnostic — verify it still works for text |
| `src/components/editor/dialogs/export-dialog.tsx` | Add "Include captions" checkbox |
| `src/components/build/render-trigger.tsx` | Pass captions payload to worker when checkbox is on |
| `src/workers/render-worker.ts` | New `captions` message field; chain `overlay` filters at final mux |
| `src/app/globals.css` | `@font-face` for Inter Regular + Bold |

**Assets (new)**

| Path | Source |
|---|---|
| `public/fonts/Inter-Regular.ttf` | Google Fonts (OFL) |
| `public/fonts/Inter-Bold.ttf` | Google Fonts (OFL) |

---

## Conventions

- **Test command:** `pnpm test <path>` (vitest run). Watch mode not used in tasks.
- **Test files:** colocated under `__tests__/` matching the source folder (existing pattern in `src/lib/overlay/__tests__/`).
- **Commit cadence:** one commit per task (after both tests and any wiring pass).
- **Frame snap:** existing `snapMsToFrame` from `src/lib/frame-align.ts` — call on every `startMs` / `endMs` mutation involving user drag.
- **Position units stored:** all positions as `0..1` floats relative to OUTPUT video. Font size as `0..1` fraction of OUTPUT height. All px conversions are derived at render time.
- **Magic constants** (define once in `text-style-defaults.ts`):
  - `TEXT_OVERLAY_DEFAULT_DURATION_MS = 2000` (manual add)
  - `TEXT_OVERLAY_SNAP_AXES = [0.1, 0.5, 0.9]`
  - `TEXT_OVERLAY_SNAP_THRESHOLD_PX = 12`
  - `TEXT_OVERLAY_DEFAULT_TRACK_INDEX = 0` (irrelevant for text — always topmost via render order)

---

## Task 1: TextOverlay type + style defaults

**Files:**
- Modify: `src/lib/overlay/overlay-types.ts`
- Create: `src/lib/text-overlay/text-overlay-types.ts`
- Create: `src/lib/text-overlay/text-style-defaults.ts`
- Create: `src/lib/text-overlay/__tests__/text-style-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/text-overlay/__tests__/text-style-defaults.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_TEXT_STYLE, AVAILABLE_FONTS } from "../text-style-defaults";

describe("DEFAULT_TEXT_STYLE", () => {
  it("matches the design spec defaults", () => {
    expect(DEFAULT_TEXT_STYLE.fontFamily).toBe("Inter");
    expect(DEFAULT_TEXT_STYLE.fontWeight).toBe(700);
    expect(DEFAULT_TEXT_STYLE.fontSizeFrac).toBeCloseTo(0.05);
    expect(DEFAULT_TEXT_STYLE.textColor).toBe("#000000");
    expect(DEFAULT_TEXT_STYLE.bgEnabled).toBe(true);
    expect(DEFAULT_TEXT_STYLE.bgColor).toBe("#ffffff");
    expect(DEFAULT_TEXT_STYLE.bgOpacity).toBe(1);
    expect(DEFAULT_TEXT_STYLE.strokeEnabled).toBe(false);
    expect(DEFAULT_TEXT_STYLE.alignment).toBe("center");
    expect(DEFAULT_TEXT_STYLE.positionXFrac).toBeCloseTo(0.5);
    expect(DEFAULT_TEXT_STYLE.positionYFrac).toBeCloseTo(0.85);
    expect(DEFAULT_TEXT_STYLE.maxWidthFrac).toBeCloseTo(0.8);
  });

  it("registers Inter as the only available font in v1", () => {
    expect(AVAILABLE_FONTS).toEqual([
      { id: "Inter", label: "Classic", regular: "/fonts/Inter-Regular.ttf", bold: "/fonts/Inter-Bold.ttf" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/text-overlay/__tests__/text-style-defaults.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the union type**

Edit `src/lib/overlay/overlay-types.ts` — replace entire file:

```ts
export interface OverlayBase {
  id: string;
  kind: string;
  trackIndex: number;
  startMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface BrollVideoOverlay extends OverlayBase {
  kind: "broll-video";
  clipId: string;
  fileId: string;
  sourceStartMs: number;
  sourceDurationMs: number;
}

export interface TextOverlay extends OverlayBase {
  kind: "text";
  text: string;
  source: "auto-script" | "manual";
  sectionLineNumber?: number;
  // Style (all numbers are 0..1 fractions of output dimensions where applicable).
  fontFamily: "Inter";
  fontWeight: 400 | 700;
  fontSizeFrac: number;
  textColor: string;
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;
  bgPaddingXFrac: number;
  bgPaddingYFrac: number;
  bgRadiusFrac: number;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidthFrac: number;
  alignment: "left" | "center" | "right";
  positionXFrac: number;
  positionYFrac: number;
  maxWidthFrac: number;
}

export type OverlayItem = BrollVideoOverlay | TextOverlay;
export type OverlayKind = OverlayItem["kind"];
```

- [ ] **Step 4: Create the types pointer file**

Create `src/lib/text-overlay/text-overlay-types.ts`:

```ts
export type { TextOverlay } from "@/lib/overlay/overlay-types";

export type TextStyle = {
  fontFamily: "Inter";
  fontWeight: 400 | 700;
  fontSizeFrac: number;
  textColor: string;
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;
  bgPaddingXFrac: number;
  bgPaddingYFrac: number;
  bgRadiusFrac: number;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidthFrac: number;
  alignment: "left" | "center" | "right";
  positionXFrac: number;
  positionYFrac: number;
  maxWidthFrac: number;
};

export const TEXT_OVERLAY_APPLY_ALL_PREF_KEY = "text-overlay-apply-all";
```

- [ ] **Step 5: Create style defaults file**

Create `src/lib/text-overlay/text-style-defaults.ts`:

```ts
import type { TextStyle } from "./text-overlay-types";

export const TEXT_OVERLAY_DEFAULT_DURATION_MS = 2000;
export const TEXT_OVERLAY_SNAP_AXES = [0.1, 0.5, 0.9] as const;
export const TEXT_OVERLAY_SNAP_THRESHOLD_PX = 12;
export const TEXT_OVERLAY_DEFAULT_TRACK_INDEX = 0;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "Inter",
  fontWeight: 700,
  fontSizeFrac: 0.05,
  textColor: "#000000",
  bgEnabled: true,
  bgColor: "#ffffff",
  bgOpacity: 1,
  bgPaddingXFrac: 0.015,
  bgPaddingYFrac: 0.008,
  bgRadiusFrac: 0.5,
  strokeEnabled: false,
  strokeColor: "#000000",
  strokeWidthFrac: 0.003,
  alignment: "center",
  positionXFrac: 0.5,
  positionYFrac: 0.85,
  maxWidthFrac: 0.8,
};

export const AVAILABLE_FONTS = [
  {
    id: "Inter" as const,
    label: "Classic",
    regular: "/fonts/Inter-Regular.ttf",
    bold: "/fonts/Inter-Bold.ttf",
  },
];
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/lib/text-overlay/__tests__/text-style-defaults.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: clean (no errors). Existing files that destructure `overlay.kind === "broll-video"` should already narrow correctly because the union still includes both variants.

- [ ] **Step 8: Commit**

```bash
git add src/lib/overlay/overlay-types.ts src/lib/text-overlay
git commit -m "feat(text-overlay): add TextOverlay type and style defaults"
```

---

## Task 2: Kind-aware overlay store (b-roll logic ignores text overlays)

**Files:**
- Modify: `src/lib/overlay/overlay-store.ts`
- Modify: `src/lib/overlay/overlay-render-plan.ts`
- Create: `src/lib/overlay/__tests__/overlay-store-kind-aware.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/overlay/__tests__/overlay-store-kind-aware.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compactTracks, addOverlayWithNewTrack } from "../overlay-store";
import type { OverlayItem } from "../overlay-types";

const broll = (id: string, trackIndex: number): OverlayItem => ({
  id, kind: "broll-video", trackIndex, startMs: 0, durationMs: 1000,
  volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
  clipId: "c1", fileId: "f1", sourceStartMs: 0, sourceDurationMs: 1000,
});

const text = (id: string): OverlayItem => ({
  id, kind: "text", trackIndex: 0, startMs: 0, durationMs: 1000,
  volume: 1, muted: false, fadeInMs: 0, fadeOutMs: 0,
  text: "hi", source: "manual",
  fontFamily: "Inter", fontWeight: 700, fontSizeFrac: 0.05, textColor: "#000",
  bgEnabled: true, bgColor: "#fff", bgOpacity: 1,
  bgPaddingXFrac: 0.015, bgPaddingYFrac: 0.008, bgRadiusFrac: 0.5,
  strokeEnabled: false, strokeColor: "#000", strokeWidthFrac: 0.003,
  alignment: "center", positionXFrac: 0.5, positionYFrac: 0.85, maxWidthFrac: 0.8,
});

describe("compactTracks — kind-aware", () => {
  it("compacts only broll-video trackIndices and leaves text overlays untouched", () => {
    const result = compactTracks([broll("a", 2), broll("b", 5), text("t1")]);
    const a = result.find((o) => o.id === "a")!;
    const b = result.find((o) => o.id === "b")!;
    const t = result.find((o) => o.id === "t1")!;
    expect(a.trackIndex).toBe(0);
    expect(b.trackIndex).toBe(1);
    expect(t.trackIndex).toBe(0); // unchanged
    expect(t.kind).toBe("text");
  });
});

describe("addOverlayWithNewTrack — kind-aware", () => {
  it("only shifts broll-video items when inserting a new broll overlay", () => {
    const next = broll("new", 1);
    const result = addOverlayWithNewTrack([broll("a", 1), text("t1")], next);
    const a = result.find((o) => o.id === "a")!;
    const t = result.find((o) => o.id === "t1")!;
    expect(a.trackIndex).toBe(2);
    expect(t.trackIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/overlay/__tests__/overlay-store-kind-aware.test.ts`
Expected: FAIL — `t.trackIndex` ends up renumbered.

- [ ] **Step 3: Update `compactTracks` and `addOverlayWithNewTrack`**

Edit `src/lib/overlay/overlay-store.ts` — replace both functions:

```ts
export function addOverlayWithNewTrack(
  overlays: OverlayItem[],
  next: OverlayItem,
): OverlayItem[] {
  const shifted = overlays.map((o) => {
    if (o.kind !== "broll-video") return o;
    return o.trackIndex >= next.trackIndex ? { ...o, trackIndex: o.trackIndex + 1 } : o;
  });
  return [...shifted, next];
}

export function compactTracks(overlays: OverlayItem[]): OverlayItem[] {
  const brollIndices = Array.from(
    new Set(overlays.filter((o) => o.kind === "broll-video").map((o) => o.trackIndex)),
  ).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  brollIndices.forEach((idx, newIdx) => remap.set(idx, newIdx));
  return overlays.map((o) => {
    if (o.kind !== "broll-video") return o;
    return { ...o, trackIndex: remap.get(o.trackIndex) ?? o.trackIndex };
  });
}
```

- [ ] **Step 4: Filter render-plan helpers to broll-video**

Read `src/lib/overlay/overlay-render-plan.ts` first to understand current shape, then edit so `findTopmostActive` and `findActiveOverlays` (any function that picks a *video* to show) operate only on b-roll. Concretely: change `(overlays: OverlayItem[]) => ...` body to start with `const brolls = overlays.filter((o): o is Extract<OverlayItem, { kind: "broll-video" }> => o.kind === "broll-video");` and then iterate `brolls` instead of `overlays`. Update the function return types from `OverlayItem` to `BrollVideoOverlay` where appropriate.

- [ ] **Step 5: Run all overlay tests + new test**

Run: `pnpm test src/lib/overlay/`
Expected: existing tests still PASS, new kind-aware test PASS.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/overlay
git commit -m "feat(overlay): make compactTracks and render-plan b-roll-aware"
```

---

## Task 3: Bundle Inter font + @font-face

**Files:**
- Create: `public/fonts/Inter-Regular.ttf` (download from Google Fonts)
- Create: `public/fonts/Inter-Bold.ttf` (download from Google Fonts)
- Modify: `src/app/globals.css`

- [ ] **Step 1: Download fonts**

Run from repo root:

```bash
mkdir -p public/fonts
curl -L -o public/fonts/Inter-Regular.ttf "https://github.com/rsms/inter/raw/v4.0/docs/font-files/Inter-Regular.ttf"
curl -L -o public/fonts/Inter-Bold.ttf "https://github.com/rsms/inter/raw/v4.0/docs/font-files/Inter-Bold.ttf"
```

Verify size (should each be > 200 KB):

```bash
ls -lh public/fonts/Inter-*.ttf
```

Expected: two files, each ~300 KB.

- [ ] **Step 2: Add `@font-face` to globals.css**

Open `src/app/globals.css` and append at the top of the file (before any `@layer`):

```css
@font-face {
  font-family: "Inter";
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url("/fonts/Inter-Regular.ttf") format("truetype");
}
@font-face {
  font-family: "Inter";
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  src: url("/fonts/Inter-Bold.ttf") format("truetype");
}
```

- [ ] **Step 3: Smoke check the dev server**

Run: `pnpm dev` in one terminal. In another, hit `curl -I http://localhost:3000/fonts/Inter-Bold.ttf`.
Expected: `HTTP/1.1 200 OK`. Stop the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add public/fonts src/app/globals.css
git commit -m "feat(text-overlay): bundle Inter font (Regular + Bold) and register @font-face"
```

---

## Task 4: Canvas-based PNG renderer (pure logic + tests)

**Files:**
- Create: `src/lib/text-overlay/text-overlay-render.ts`
- Create: `src/lib/text-overlay/__tests__/text-overlay-render.test.ts`

The renderer must be a pure function so it can run identically in the browser (preview) and from the worker (export). It depends only on a `CanvasRenderingContext2D`. Line-wrapping uses `ctx.measureText`. Tests assert geometry (lines count, total height, x positions) — not pixel output.

- [ ] **Step 1: Write the failing test**

Create `src/lib/text-overlay/__tests__/text-overlay-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wrapTextToLines, computeOverlayPixelBox } from "../text-overlay-render";
import { DEFAULT_TEXT_STYLE } from "../text-style-defaults";

// Minimal mock of CanvasRenderingContext2D.measureText.
// Each character has fixed advance = 10px regardless of font.
const mockCtx = {
  measureText: (s: string) => ({ width: s.length * 10 }),
} as unknown as CanvasRenderingContext2D;

describe("wrapTextToLines", () => {
  it("returns a single line when text fits", () => {
    const lines = wrapTextToLines(mockCtx, "hello world", 200);
    expect(lines).toEqual(["hello world"]);
  });

  it("breaks on word boundaries when exceeding maxWidthPx", () => {
    // 'foo bar baz' = 'foo'(30) + ' '(10) + 'bar'(30) = 70 fits in 80; then ' baz'(40) overflows.
    const lines = wrapTextToLines(mockCtx, "foo bar baz", 80);
    expect(lines).toEqual(["foo bar", "baz"]);
  });

  it("respects explicit newlines from the user", () => {
    const lines = wrapTextToLines(mockCtx, "foo\nbar baz", 1000);
    expect(lines).toEqual(["foo", "bar baz"]);
  });

  it("breaks a single overlong token onto its own line without crashing", () => {
    const lines = wrapTextToLines(mockCtx, "supercalifragilistic", 50);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join(" ")).toBe("supercalifragilistic");
  });
});

describe("computeOverlayPixelBox", () => {
  const outW = 1080;
  const outH = 1920;

  it("places the box centered horizontally at default style", () => {
    const box = computeOverlayPixelBox(mockCtx, "hello", DEFAULT_TEXT_STYLE, outW, outH);
    expect(box.lines).toEqual(["hello"]);
    // Width = textWidth + 2*paddingX. Mock text 'hello' = 50px wide.
    const padX = Math.round(DEFAULT_TEXT_STYLE.bgPaddingXFrac * outW);
    const expectedWidth = 50 + 2 * padX;
    expect(box.width).toBe(expectedWidth);
    // Box centered: x = (outW * positionXFrac) - width/2.
    expect(box.x).toBe(Math.round(outW * 0.5 - expectedWidth / 2));
  });

  it("anchors the box bottom at positionYFrac (anchor = bottom-center of caption)", () => {
    const box = computeOverlayPixelBox(mockCtx, "hello", DEFAULT_TEXT_STYLE, outW, outH);
    expect(box.y + box.height).toBe(Math.round(outH * 0.85));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/text-overlay/__tests__/text-overlay-render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

Create `src/lib/text-overlay/text-overlay-render.ts`:

```ts
import type { TextStyle } from "./text-overlay-types";

export interface OverlayPixelBox {
  x: number;        // top-left
  y: number;
  width: number;
  height: number;
  lines: string[];
  lineHeight: number;
  fontSizePx: number;
  paddingXPx: number;
  paddingYPx: number;
}

const LINE_HEIGHT_MULTIPLIER = 1.25;

export function wrapTextToLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
): string[] {
  const explicit = text.split("\n");
  const out: string[] = [];
  for (const paragraph of explicit) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const w of words) {
      const candidate = current.length === 0 ? w : `${current} ${w}`;
      if (ctx.measureText(candidate).width <= maxWidthPx || current.length === 0) {
        current = candidate;
      } else {
        out.push(current);
        current = w;
      }
    }
    if (current.length > 0) out.push(current);
  }
  return out.length === 0 ? [""] : out;
}

export function computeOverlayPixelBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  outputWidthPx: number,
  outputHeightPx: number,
): OverlayPixelBox {
  const fontSizePx = Math.round(style.fontSizeFrac * outputHeightPx);
  const paddingXPx = Math.round(style.bgPaddingXFrac * outputWidthPx);
  const paddingYPx = Math.round(style.bgPaddingYFrac * outputHeightPx);
  const maxTextWidthPx = Math.round(style.maxWidthFrac * outputWidthPx) - 2 * paddingXPx;
  ctx.font = `${style.fontWeight} ${fontSizePx}px ${style.fontFamily}, sans-serif`;
  const lines = wrapTextToLines(ctx, text, Math.max(10, maxTextWidthPx));
  const widestLinePx = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const lineHeight = Math.round(fontSizePx * LINE_HEIGHT_MULTIPLIER);
  const innerHeight = lines.length * lineHeight;
  const width = Math.round(widestLinePx + 2 * paddingXPx);
  const height = Math.round(innerHeight + 2 * paddingYPx);
  const anchorY = Math.round(style.positionYFrac * outputHeightPx);
  const anchorX = Math.round(style.positionXFrac * outputWidthPx);
  const x = anchorX - Math.round(width / 2);
  const y = anchorY - height;
  return { x, y, width, height, lines, lineHeight, fontSizePx, paddingXPx, paddingYPx };
}

// Draws onto an existing canvas at (0,0) within a region sized to box.width × box.height.
// Caller is responsible for creating the canvas at the right size and translating if needed.
export function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  outputWidthPx: number,
  outputHeightPx: number,
): OverlayPixelBox {
  const box = computeOverlayPixelBox(ctx, text, style, outputWidthPx, outputHeightPx);
  ctx.save();
  ctx.translate(-box.x, -box.y);
  if (style.bgEnabled) {
    const radius = Math.min(
      Math.round(style.bgRadiusFrac * box.height),
      Math.round(box.height / 2),
    );
    ctx.fillStyle = hexWithOpacity(style.bgColor, style.bgOpacity);
    roundRect(ctx, box.x, box.y, box.width, box.height, radius);
    ctx.fill();
  }
  ctx.font = `${style.fontWeight} ${box.fontSizePx}px ${style.fontFamily}, sans-serif`;
  ctx.textBaseline = "top";
  if (style.strokeEnabled) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = Math.max(1, Math.round(style.strokeWidthFrac * outputHeightPx));
    ctx.lineJoin = "round";
  }
  ctx.fillStyle = style.textColor;
  for (let i = 0; i < box.lines.length; i++) {
    const line = box.lines[i]!;
    const lineWidthPx = ctx.measureText(line).width;
    let textX: number;
    if (style.alignment === "left") {
      textX = box.x + box.paddingXPx;
    } else if (style.alignment === "right") {
      textX = box.x + box.width - box.paddingXPx - lineWidthPx;
    } else {
      textX = box.x + box.width / 2 - lineWidthPx / 2;
    }
    const textY = box.y + box.paddingYPx + i * box.lineHeight;
    if (style.strokeEnabled) ctx.strokeText(line, textX, textY);
    ctx.fillText(line, textX, textY);
  }
  ctx.restore();
  return box;
}

// Browser-only helper. Worker context lacks HTMLCanvasElement — use OffscreenCanvas there.
export async function renderTextOverlayToPNGBytes(
  text: string,
  style: TextStyle,
  outputWidthPx: number,
  outputHeightPx: number,
): Promise<{ bytes: Uint8Array; box: OverlayPixelBox }> {
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(outputWidthPx, outputHeightPx)
    : (() => {
        const c = document.createElement("canvas");
        c.width = outputWidthPx;
        c.height = outputHeightPx;
        return c;
      })();
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) throw new Error("2d context unavailable");
  const measureBox = computeOverlayPixelBox(ctx, text, style, outputWidthPx, outputHeightPx);
  // Render into a tightly-cropped canvas matching the box.
  const cropCanvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(Math.max(1, measureBox.width), Math.max(1, measureBox.height))
    : (() => {
        const c = document.createElement("canvas");
        c.width = Math.max(1, measureBox.width);
        c.height = Math.max(1, measureBox.height);
        return c;
      })();
  const cropCtx = cropCanvas.getContext("2d") as CanvasRenderingContext2D;
  drawTextOverlay(cropCtx, text, style, outputWidthPx, outputHeightPx);
  const blob: Blob = "convertToBlob" in cropCanvas
    ? await (cropCanvas as OffscreenCanvas).convertToBlob({ type: "image/png" })
    : await new Promise((res, rej) =>
        (cropCanvas as HTMLCanvasElement).toBlob(
          (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
          "image/png",
        ),
      );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, box: measureBox };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function hexWithOpacity(hex: string, opacity: number): string {
  // hex assumed "#rrggbb".
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return `rgba(255,255,255,${opacity})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/text-overlay/__tests__/text-overlay-render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/text-overlay/text-overlay-render.ts src/lib/text-overlay/__tests__/text-overlay-render.test.ts
git commit -m "feat(text-overlay): pure canvas renderer with word-wrap and rounded BG"
```

---

## Task 5: Text-overlay store (generate, merge, snap, applyAll)

**Files:**
- Create: `src/lib/text-overlay/text-overlay-store.ts`
- Create: `src/lib/text-overlay/__tests__/text-overlay-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/text-overlay/__tests__/text-overlay-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/text-overlay/__tests__/text-overlay-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/text-overlay/text-overlay-store.ts`:

```ts
import type { OverlayItem, TextOverlay } from "@/lib/overlay/overlay-types";
import type { ParsedSection } from "@/lib/script-parser";
import type { TextStyle } from "./text-overlay-types";
import {
  DEFAULT_TEXT_STYLE,
  TEXT_OVERLAY_DEFAULT_DURATION_MS,
  TEXT_OVERLAY_DEFAULT_TRACK_INDEX,
} from "./text-style-defaults";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function makeTextOverlay(args: {
  id?: string;
  startMs: number;
  durationMs: number;
  text: string;
  source: TextOverlay["source"];
  sectionLineNumber?: number;
  style: TextStyle;
}): TextOverlay {
  return {
    id: args.id ?? newId(),
    kind: "text",
    trackIndex: TEXT_OVERLAY_DEFAULT_TRACK_INDEX,
    startMs: args.startMs,
    durationMs: args.durationMs,
    volume: 1,
    muted: false,
    fadeInMs: 0,
    fadeOutMs: 0,
    text: args.text,
    source: args.source,
    ...(args.sectionLineNumber !== undefined ? { sectionLineNumber: args.sectionLineNumber } : {}),
    ...args.style,
  };
}

export function generateFromSections(
  sections: ParsedSection[],
  style: TextStyle,
): TextOverlay[] {
  return sections
    .filter((s) => s.scriptText.trim().length > 0)
    .map((s) =>
      makeTextOverlay({
        startMs: Math.round(s.startTime * 1000),
        durationMs: s.durationMs,
        text: s.scriptText,
        source: "auto-script",
        sectionLineNumber: s.lineNumber,
        style,
      }),
    );
}

export type MergeMode = "replace" | "merge";

export function mergeCaptions(
  overlays: OverlayItem[],
  sections: ParsedSection[],
  style: TextStyle,
  mode: MergeMode,
): OverlayItem[] {
  const nonText = overlays.filter((o) => o.kind !== "text");
  const text = overlays.filter((o): o is TextOverlay => o.kind === "text");
  const manuals = text.filter((t) => t.source === "manual");

  if (mode === "replace") {
    const fresh = generateFromSections(sections, style);
    return [...nonText, ...fresh, ...manuals];
  }
  // mode === "merge"
  const existingAutoByLine = new Map<number, TextOverlay>();
  for (const t of text) {
    if (t.source === "auto-script" && t.sectionLineNumber !== undefined) {
      existingAutoByLine.set(t.sectionLineNumber, t);
    }
  }
  const merged: TextOverlay[] = [];
  for (const s of sections) {
    if (s.scriptText.trim().length === 0) continue;
    const prior = existingAutoByLine.get(s.lineNumber);
    if (prior) {
      merged.push({
        ...prior,
        startMs: Math.round(s.startTime * 1000),
        durationMs: s.durationMs,
      });
    } else {
      merged.push(
        makeTextOverlay({
          startMs: Math.round(s.startTime * 1000),
          durationMs: s.durationMs,
          text: s.scriptText,
          source: "auto-script",
          sectionLineNumber: s.lineNumber,
          style,
        }),
      );
    }
  }
  return [...nonText, ...merged, ...manuals];
}

export function addManualTextOverlay(
  overlays: OverlayItem[],
  atMs: number,
  style: TextStyle,
): OverlayItem[] {
  const inserted = makeTextOverlay({
    startMs: atMs,
    durationMs: TEXT_OVERLAY_DEFAULT_DURATION_MS,
    text: "",
    source: "manual",
    style,
  });
  return [...overlays, inserted];
}

export function applyStyleToAll(
  overlays: OverlayItem[],
  patch: Partial<TextStyle>,
): OverlayItem[] {
  return overlays.map((o) => (o.kind === "text" ? { ...o, ...patch } : o));
}

export function removeTextOverlay(overlays: OverlayItem[], id: string): OverlayItem[] {
  return overlays.filter((o) => o.id !== id);
}

export interface Interval { startMs: number; durationMs: number }

// Adjusts (startMs, durationMs) so the moved interval does not overlap any other text overlay.
// Strategy: if the moved interval intersects a neighbor, push it left or right so it just
// touches the neighbor's edge. Duration is preserved.
export function snapToNeighbor(
  moved: Interval,
  movedId: string,
  others: TextOverlay[],
): Interval {
  const movedEnd = moved.startMs + moved.durationMs;
  for (const o of others) {
    if (o.id === movedId) continue;
    const oEnd = o.startMs + o.durationMs;
    const overlaps = moved.startMs < oEnd && o.startMs < movedEnd;
    if (!overlaps) continue;
    const movedCenter = moved.startMs + moved.durationMs / 2;
    const oCenter = o.startMs + o.durationMs / 2;
    if (movedCenter <= oCenter) {
      return { startMs: Math.max(0, o.startMs - moved.durationMs), durationMs: moved.durationMs };
    } else {
      return { startMs: oEnd, durationMs: moved.durationMs };
    }
  }
  return moved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/text-overlay/__tests__/text-overlay-store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run all text-overlay tests**

Run: `pnpm test src/lib/text-overlay/`
Expected: PASS (13 tests across 3 files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/text-overlay/text-overlay-store.ts src/lib/text-overlay/__tests__/text-overlay-store.test.ts
git commit -m "feat(text-overlay): store ops (generate, merge, addManual, applyAll, snap)"
```

---

## Task 6: ApplyAll sticky preference in BuildState

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Add state + setter**

In `src/components/build/build-state-context.tsx`:

Add to the `BuildState` interface (around line 52, near `audioSelected`):

```ts
  textOverlayApplyAll: boolean;
  setTextOverlayApplyAll: (v: boolean) => void;
```

Add inside `BuildStateProvider` (after the existing `useState` calls for overlays, around line 118):

```ts
  const [textOverlayApplyAll, setTextOverlayApplyAllState] = useState<boolean>(true);

  // Load sticky preference on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("text-overlay-apply-all");
    if (stored === "false") setTextOverlayApplyAllState(false);
  }, []);

  const setTextOverlayApplyAll = useCallback((v: boolean) => {
    setTextOverlayApplyAllState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("text-overlay-apply-all", v ? "true" : "false");
    }
  }, []);
```

Then in the `useMemo` value object (around line 230-275), add:

```ts
      textOverlayApplyAll,
      setTextOverlayApplyAll,
```

And add to the dependency array of the `useMemo`:

```ts
    textOverlayApplyAll,
    setTextOverlayApplyAll,
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(text-overlay): sticky applyAll preference in BuildState"
```

---

## Task 7: TrackTextOverlays — timeline row UI

**Files:**
- Create: `src/components/editor/timeline/track-text-overlays.tsx`
- Modify: `src/components/editor/timeline/timeline-panel.tsx`

This is the user-visible row directly under the ruler. Each block: rounded card with `<Type>` icon + truncated `text` snippet. Click → select. Drag body horizontally → shift `startMs` (snap-to-neighbor). Drag left/right edge → resize. Existing keyboard handler (`use-overlay-keyboard.ts`) handles Delete.

- [ ] **Step 1: Create the component**

Create `src/components/editor/timeline/track-text-overlays.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuildState } from "@/components/build/build-state-context";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import { snapToNeighbor } from "@/lib/text-overlay/text-overlay-store";
import { snapMsToFrame } from "@/lib/frame-align";

interface Props {
  pxPerSecond: number;
}

const ROW_HEIGHT = 28;
const RESIZE_HANDLE_PX = 6;
const MIN_DURATION_MS = 200;

type DragMode =
  | { kind: "move"; id: string; initialStartMs: number; pointerStartX: number }
  | { kind: "resize-left"; id: string; initialStartMs: number; initialDurationMs: number; pointerStartX: number }
  | { kind: "resize-right"; id: string; initialDurationMs: number; pointerStartX: number };

export function TrackTextOverlays({ pxPerSecond }: Props) {
  const { overlays, setOverlays, selectedOverlayId, setSelectedOverlayId } = useBuildState();
  const [drag, setDrag] = useState<DragMode | null>(null);
  const dragRef = useRef<DragMode | null>(null);
  dragRef.current = drag;

  const texts = overlays.filter((o): o is TextOverlay => o.kind === "text");

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dxMs = ((e.clientX - d.pointerStartX) / pxPerSecond) * 1000;
      setOverlays((prev) => {
        return prev.map((o) => {
          if (o.id !== d.id || o.kind !== "text") return o;
          const others = prev.filter((x): x is TextOverlay => x.kind === "text" && x.id !== d.id);
          if (d.kind === "move") {
            const proposed = { startMs: Math.max(0, snapMsToFrame(d.initialStartMs + dxMs)), durationMs: o.durationMs };
            const snapped = snapToNeighbor(proposed, d.id, others);
            return { ...o, startMs: snapped.startMs };
          } else if (d.kind === "resize-left") {
            const newStart = Math.max(0, snapMsToFrame(d.initialStartMs + dxMs));
            const maxStart = d.initialStartMs + d.initialDurationMs - MIN_DURATION_MS;
            const clampedStart = Math.min(newStart, maxStart);
            const newDuration = d.initialStartMs + d.initialDurationMs - clampedStart;
            const proposed = { startMs: clampedStart, durationMs: newDuration };
            const snapped = snapToNeighbor(proposed, d.id, others);
            return { ...o, startMs: snapped.startMs, durationMs: snapped.durationMs };
          } else {
            const proposedDuration = Math.max(MIN_DURATION_MS, snapMsToFrame(d.initialDurationMs + dxMs));
            const proposed = { startMs: o.startMs, durationMs: proposedDuration };
            const snapped = snapToNeighbor(proposed, d.id, others);
            return { ...o, startMs: snapped.startMs, durationMs: snapped.durationMs };
          }
        });
      });
    }
    function onUp() { setDrag(null); }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [drag, pxPerSecond, setOverlays]);

  function startDrag(e: React.PointerEvent, t: TextOverlay) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const localX = e.clientX - rect.left;
    e.preventDefault();
    e.stopPropagation();
    setSelectedOverlayId(t.id);
    if (localX < RESIZE_HANDLE_PX) {
      setDrag({ kind: "resize-left", id: t.id, initialStartMs: t.startMs, initialDurationMs: t.durationMs, pointerStartX: e.clientX });
    } else if (localX > rect.width - RESIZE_HANDLE_PX) {
      setDrag({ kind: "resize-right", id: t.id, initialDurationMs: t.durationMs, pointerStartX: e.clientX });
    } else {
      setDrag({ kind: "move", id: t.id, initialStartMs: t.startMs, pointerStartX: e.clientX });
    }
  }

  return (
    <div className="relative" style={{ height: `${ROW_HEIGHT}px` }}>
      {texts.map((t) => {
        const left = (t.startMs / 1000) * pxPerSecond;
        const width = Math.max(8, (t.durationMs / 1000) * pxPerSecond);
        const isSelected = selectedOverlayId === t.id;
        return (
          <div
            key={t.id}
            data-overlay-block
            data-kind="text"
            onPointerDown={(e) => startDrag(e, t)}
            className={cn(
              "absolute top-1 bottom-1 rounded-md border text-[10px] font-medium flex items-center gap-1 px-1.5 select-none overflow-hidden cursor-grab",
              "bg-orange-500/15 border-orange-500/40 text-orange-200",
              isSelected && "ring-2 ring-orange-400 ring-offset-1 ring-offset-background",
            )}
            style={{ left: `${left}px`, width: `${width}px` }}
            title={t.text}
          >
            <Type className="w-3 h-3 shrink-0" />
            <span className="truncate">{t.text || "Edit text…"}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Insert into `<TimelinePanel>` between Ruler and TrackTags**

In `src/components/editor/timeline/timeline-panel.tsx`:

Add import (after the other timeline imports):

```ts
import { TrackTextOverlays } from "./track-text-overlays";
```

Replace the JSX block that currently reads `<TimelineRuler ... /> {timeline ? ( <> <TrackTags ... /> <OverlayTracks ... /> <TrackClips ... /> </> ) : ... }` (lines 106-128) so it becomes:

```tsx
          <TimelineRuler totalMs={renderMs} pxPerSecond={effectivePxPerSec} />
          <TrackTextOverlays pxPerSecond={effectivePxPerSec} />
          {timeline ? (
            <>
              <TrackTags
                timeline={timeline}
                pxPerSecond={effectivePxPerSec}
                selectedIndex={selectedSectionIndex}
                onSelect={setSelectedSectionIndex}
                onToggleLock={toggleSectionLock}
              />
              <OverlayTracks pxPerSecond={effectivePxPerSec} />
              <TrackClips
                timeline={timeline}
                pxPerSecond={effectivePxPerSec}
                selectedIndex={selectedSectionIndex}
                onSelect={setSelectedSectionIndex}
              />
            </>
          ) : (
            <div className="h-[130px] flex items-center px-3 text-xs text-muted-foreground">
              Paste script in the toolbar to populate sections.
            </div>
          )}
```

- [ ] **Step 3: Manual smoke check**

Run: `pnpm dev`. Open localhost:3000. Manually:

1. Paste a script with timestamps; existing tag row appears.
2. Click in the top track-text-overlays row area — nothing happens (no overlays yet) — this is correct.
3. Stop the server.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/timeline/track-text-overlays.tsx src/components/editor/timeline/timeline-panel.tsx
git commit -m "feat(text-overlay): single-row timeline UI with drag/resize/snap"
```

---

## Task 8: Toolbar buttons + GenerateCaptionsDialog

**Files:**
- Create: `src/components/editor/toolbar/generate-captions-button.tsx`
- Create: `src/components/editor/toolbar/add-text-button.tsx`
- Create: `src/components/editor/dialogs/generate-captions-dialog.tsx`
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Create the dialog**

Create `src/components/editor/dialogs/generate-captions-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: () => void;
  onMerge: () => void;
}

export function GenerateCaptionsDialog({ open, onOpenChange, onReplace, onMerge }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate captions from script</DialogTitle>
          <DialogDescription>
            You already have text overlays. Replace will re-create captions for every script section
            (manual text overlays are preserved). Merge keeps your existing edits — only new sections
            get new captions and removed sections are dropped.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={onMerge}>Merge</Button>
          <Button variant="destructive" onClick={onReplace}>Replace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the Generate Captions button**

Create `src/components/editor/toolbar/generate-captions-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { DEFAULT_TEXT_STYLE } from "@/lib/text-overlay/text-style-defaults";
import { generateFromSections, mergeCaptions } from "@/lib/text-overlay/text-overlay-store";
import { GenerateCaptionsDialog } from "../dialogs/generate-captions-dialog";

export function GenerateCaptionsButton() {
  const { sections, overlays, setOverlays } = useBuildState();
  const [open, setOpen] = useState(false);
  const hasExistingText = overlays.some((o) => o.kind === "text");

  function onClick() {
    if (!sections || sections.length === 0) return;
    if (!hasExistingText) {
      const fresh = generateFromSections(sections, DEFAULT_TEXT_STYLE);
      setOverlays((prev) => [...prev, ...fresh]);
      return;
    }
    setOpen(true);
  }

  function doReplace() {
    if (!sections) return;
    setOverlays((prev) => mergeCaptions(prev, sections, DEFAULT_TEXT_STYLE, "replace"));
    setOpen(false);
  }
  function doMerge() {
    if (!sections) return;
    setOverlays((prev) => mergeCaptions(prev, sections, DEFAULT_TEXT_STYLE, "merge"));
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!sections || sections.length === 0}
        onClick={onClick}
        title="Generate captions from parsed script sections"
      >
        <Captions className="w-3.5 h-3.5 mr-1" />
        Generate captions
      </Button>
      <GenerateCaptionsDialog open={open} onOpenChange={setOpen} onReplace={doReplace} onMerge={doMerge} />
    </>
  );
}
```

- [ ] **Step 3: Create the Add Text button**

Create `src/components/editor/toolbar/add-text-button.tsx`:

```tsx
"use client";

import { Type as TypeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { addManualTextOverlay } from "@/lib/text-overlay/text-overlay-store";
import { DEFAULT_TEXT_STYLE } from "@/lib/text-overlay/text-style-defaults";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import type { TextStyle } from "@/lib/text-overlay/text-overlay-types";

const TEXT_STYLE_KEYS: (keyof TextStyle)[] = [
  "fontFamily", "fontWeight", "fontSizeFrac", "textColor",
  "bgEnabled", "bgColor", "bgOpacity", "bgPaddingXFrac", "bgPaddingYFrac", "bgRadiusFrac",
  "strokeEnabled", "strokeColor", "strokeWidthFrac",
  "alignment", "positionXFrac", "positionYFrac", "maxWidthFrac",
];

function styleFromLastEdited(overlays: TextOverlay[]): TextStyle {
  if (overlays.length === 0) return DEFAULT_TEXT_STYLE;
  const last = overlays[overlays.length - 1]!;
  const style = {} as TextStyle;
  for (const k of TEXT_STYLE_KEYS) {
    (style as Record<string, unknown>)[k] = (last as Record<string, unknown>)[k];
  }
  return style;
}

export function AddTextButton() {
  const { overlays, setOverlays, playheadMs, setSelectedOverlayId } = useBuildState();

  function onClick() {
    const existingText = overlays.filter((o): o is TextOverlay => o.kind === "text");
    const style = styleFromLastEdited(existingText);
    setOverlays((prev) => {
      const next = addManualTextOverlay(prev, playheadMs, style);
      const added = next[next.length - 1]!;
      queueMicrotask(() => setSelectedOverlayId(added.id));
      return next;
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick} title="Add text overlay at playhead">
      <TypeIcon className="w-3.5 h-3.5 mr-1" />
      Add text
    </Button>
  );
}
```

- [ ] **Step 4: Mount the buttons in `<EditorShell>`**

In `src/components/editor/editor-shell.tsx`:

Add imports (with the other toolbar imports near line 13):

```ts
import { GenerateCaptionsButton } from "./toolbar/generate-captions-button";
import { AddTextButton } from "./toolbar/add-text-button";
```

Inside the toolbar div, BEFORE the `<ShuffleButton />` (right side, around line 93-95):

```tsx
        <div className="ml-auto flex items-center gap-2">
          <GenerateCaptionsButton />
          <AddTextButton />
          <ShuffleButton />
          <ExportButton />
        </div>
```

- [ ] **Step 5: Manual smoke check**

Run: `pnpm dev`. Paste a script, then:
1. Click "Generate captions" — orange blocks should appear in the top timeline row.
2. Click "Generate captions" again — dialog appears. Click Cancel.
3. Click "+ Add text" — a new short block appears at the playhead.

Stop the server.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/toolbar/generate-captions-button.tsx \
        src/components/editor/toolbar/add-text-button.tsx \
        src/components/editor/dialogs/generate-captions-dialog.tsx \
        src/components/editor/editor-shell.tsx
git commit -m "feat(text-overlay): toolbar buttons + Generate captions confirm dialog"
```

---

## Task 9: Text overlay inspector

**Files:**
- Create: `src/components/editor/overlay/text-overlay-inspector.tsx`
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Create the inspector**

Create `src/components/editor/overlay/text-overlay-inspector.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import { mutateOverlay, removeOverlay } from "@/lib/overlay/overlay-store";
import { applyStyleToAll } from "@/lib/text-overlay/text-overlay-store";
import { AVAILABLE_FONTS } from "@/lib/text-overlay/text-style-defaults";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import type { TextStyle } from "@/lib/text-overlay/text-overlay-types";

interface Props { overlayId: string }

const STYLE_KEYS: (keyof TextStyle)[] = [
  "fontFamily", "fontWeight", "fontSizeFrac", "textColor",
  "bgEnabled", "bgColor", "bgOpacity", "bgPaddingXFrac", "bgPaddingYFrac", "bgRadiusFrac",
  "strokeEnabled", "strokeColor", "strokeWidthFrac",
  "alignment", "positionXFrac", "positionYFrac", "maxWidthFrac",
];

export function TextOverlayInspector({ overlayId }: Props) {
  const {
    overlays, setOverlays, setSelectedOverlayId,
    textOverlayApplyAll, setTextOverlayApplyAll,
  } = useBuildState();
  const overlay = overlays.find((o) => o.id === overlayId && o.kind === "text") as TextOverlay | undefined;

  useEffect(() => {
    if (!overlay) setSelectedOverlayId(null);
  }, [overlay, setSelectedOverlayId]);

  if (!overlay) return null;

  function onPatchSingle(patch: Partial<TextOverlay>) {
    setOverlays((prev) => mutateOverlay(prev, overlay!.id, patch));
  }
  function onPatchStyle(patch: Partial<TextStyle>) {
    if (textOverlayApplyAll) {
      const styleOnly: Partial<TextStyle> = {};
      for (const k of STYLE_KEYS) {
        if (k in patch) (styleOnly as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
      }
      setOverlays((prev) => applyStyleToAll(prev, styleOnly));
    } else {
      setOverlays((prev) => mutateOverlay(prev, overlay!.id, patch));
    }
  }
  function onDelete() {
    setOverlays((prev) => removeOverlay(prev, overlay!.id));
    setSelectedOverlayId(null);
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto p-3 text-xs gap-3">
      <label className="flex items-center gap-2 pb-2 border-b border-border">
        <input
          type="checkbox"
          checked={textOverlayApplyAll}
          onChange={(e) => setTextOverlayApplyAll(e.target.checked)}
        />
        <span className="font-medium">Apply to all main captions</span>
      </label>

      <div className="space-y-1">
        <span className="block">Text</span>
        <textarea
          value={overlay.text}
          onChange={(e) => onPatchSingle({ text: e.target.value })}
          rows={3}
          className="w-full px-2 py-1.5 rounded bg-muted/40 border border-border resize-y"
        />
      </div>

      <div className="space-y-1">
        <span className="block">Font</span>
        <select
          value={overlay.fontFamily}
          onChange={(e) => onPatchStyle({ fontFamily: e.target.value as TextStyle["fontFamily"] })}
          className="w-full px-2 py-1 rounded bg-muted/40 border border-border"
        >
          {AVAILABLE_FONTS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>Font size</span>
          <span className="font-mono">{Math.round(overlay.fontSizeFrac * 100)}%</span>
        </div>
        <input
          type="range" min={2} max={15} step={1}
          value={Math.round(overlay.fontSizeFrac * 100)}
          onChange={(e) => onPatchStyle({ fontSizeFrac: Number(e.target.value) / 100 })}
          className="w-full"
        />
      </div>

      <div className="space-y-1">
        <span className="block">Text color</span>
        <input
          type="color"
          value={overlay.textColor}
          onChange={(e) => onPatchStyle({ textColor: e.target.value })}
          className="h-7 w-12 border border-border rounded"
        />
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={overlay.bgEnabled}
            onChange={(e) => onPatchStyle({ bgEnabled: e.target.checked })}
          />
          <span className="font-medium">Background</span>
        </label>
        {overlay.bgEnabled && (
          <div className="space-y-1.5 pl-5">
            <div className="flex items-center gap-2">
              <span>Color</span>
              <input
                type="color"
                value={overlay.bgColor}
                onChange={(e) => onPatchStyle({ bgColor: e.target.value })}
                className="h-7 w-10 border border-border rounded"
              />
            </div>
            <div>
              <div className="flex justify-between"><span>Opacity</span><span className="font-mono">{Math.round(overlay.bgOpacity * 100)}%</span></div>
              <input type="range" min={0} max={100} step={5}
                value={Math.round(overlay.bgOpacity * 100)}
                onChange={(e) => onPatchStyle({ bgOpacity: Number(e.target.value) / 100 })}
                className="w-full" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={overlay.strokeEnabled}
            onChange={(e) => onPatchStyle({ strokeEnabled: e.target.checked })}
          />
          <span className="font-medium">Outline</span>
        </label>
        {overlay.strokeEnabled && (
          <div className="space-y-1.5 pl-5">
            <div className="flex items-center gap-2">
              <span>Color</span>
              <input
                type="color"
                value={overlay.strokeColor}
                onChange={(e) => onPatchStyle({ strokeColor: e.target.value })}
                className="h-7 w-10 border border-border rounded"
              />
            </div>
            <div>
              <div className="flex justify-between"><span>Width</span><span className="font-mono">{(overlay.strokeWidthFrac * 100).toFixed(1)}%</span></div>
              <input type="range" min={1} max={20} step={1}
                value={Math.round(overlay.strokeWidthFrac * 1000)}
                onChange={(e) => onPatchStyle({ strokeWidthFrac: Number(e.target.value) / 1000 })}
                className="w-full" />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <div className="flex justify-between"><span>Y position</span><span className="font-mono">{Math.round(overlay.positionYFrac * 100)}%</span></div>
        <input type="range" min={5} max={95} step={1}
          value={Math.round(overlay.positionYFrac * 100)}
          onChange={(e) => onPatchStyle({ positionYFrac: Number(e.target.value) / 100 })}
          className="w-full" />
        <div className="flex justify-between"><span>X position</span><span className="font-mono">{Math.round(overlay.positionXFrac * 100)}%</span></div>
        <input type="range" min={5} max={95} step={1}
          value={Math.round(overlay.positionXFrac * 100)}
          onChange={(e) => onPatchStyle({ positionXFrac: Number(e.target.value) / 100 })}
          className="w-full" />
        <div className="flex justify-between"><span>Max width</span><span className="font-mono">{Math.round(overlay.maxWidthFrac * 100)}%</span></div>
        <input type="range" min={30} max={100} step={5}
          value={Math.round(overlay.maxWidthFrac * 100)}
          onChange={(e) => onPatchStyle({ maxWidthFrac: Number(e.target.value) / 100 })}
          className="w-full" />
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto w-full flex items-center justify-center gap-1 py-1.5 text-red-400 hover:bg-red-500/10 rounded border border-red-500/30"
      >
        <Trash2 className="w-3 h-3" />
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Route to it from `<EditorShell>`**

In `src/components/editor/editor-shell.tsx`:

Add import near line 22:

```ts
import { TextOverlayInspector } from "./overlay/text-overlay-inspector";
```

Replace the `inspectorMode === "overlay" && selectedOverlayId ? <OverlayInspector .../> : ...` line (around line 106-108) with:

```tsx
        {inspectorMode === "overlay" && selectedOverlayId ? (() => {
          const sel = (useBuildState as never) as never; // no — instead inline the lookup below
          return null;
        })() : null}
```

That doesn't compile — instead, take the cleaner approach. Read the `overlays` array at the top of `EditorShell` (it's already destructured from `useBuildState` via `selectedOverlayId`; we need `overlays` too). Add `overlays` to the destructuring at line 28-48:

```ts
    overlays,
```

Then replace the inspector ternary (around line 106-108) with:

```tsx
        {inspectorMode === "overlay" && selectedOverlayId ? (
          overlays.find((o) => o.id === selectedOverlayId)?.kind === "text"
            ? <TextOverlayInspector overlayId={selectedOverlayId} />
            : <OverlayInspector overlayId={selectedOverlayId} />
        ) : inspectorMode === "audio" ? (
          <AudioInspector />
        ) : (...rest of the block unchanged...)
        }
```

(Keep the existing `inspectorMode === "section"` branch as-is.)

- [ ] **Step 3: Manual smoke check**

Run: `pnpm dev`. Generate captions, click a block, change "Font size" — see numbers update; with Apply-all ON, all blocks change.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/overlay/text-overlay-inspector.tsx src/components/editor/editor-shell.tsx
git commit -m "feat(text-overlay): sidebar inspector with Apply-all toggle"
```

---

## Task 10: Preview rendering — TextOverlayLayer

**Files:**
- Create: `src/components/editor/preview/text-overlay-layer.tsx`
- Modify: `src/components/editor/preview/preview-player.tsx`

The layer renders one absolutely-positioned `<canvas>` (or `<div>` representation) per active text overlay at the current `playheadMs`. To stay simple and reuse the renderer: each text overlay gets its own `<canvas>` element sized to the preview frame (devicePixelRatio-aware) and redrawn whenever `(text, style, frameWidthPx, frameHeightPx)` changes (debounced 300ms for typing).

- [ ] **Step 1: Create the layer**

Create `src/components/editor/preview/text-overlay-layer.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import type { TextOverlay } from "@/lib/overlay/overlay-types";
import { drawTextOverlay, computeOverlayPixelBox } from "@/lib/text-overlay/text-overlay-render";
import { mutateOverlay } from "@/lib/overlay/overlay-store";
import { TEXT_OVERLAY_SNAP_AXES, TEXT_OVERLAY_SNAP_THRESHOLD_PX } from "@/lib/text-overlay/text-style-defaults";

interface Props {
  frameWidthPx: number;
  frameHeightPx: number;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return v;
}

export function TextOverlayLayer({ frameWidthPx, frameHeightPx }: Props) {
  const { overlays, playheadMs, selectedOverlayId, setSelectedOverlayId, setOverlays } = useBuildState();
  const visibleTexts = overlays.filter(
    (o): o is TextOverlay =>
      o.kind === "text" && playheadMs >= o.startMs && playheadMs < o.startMs + o.durationMs,
  );
  // Debounce for redrawing on rapid keystroke changes.
  const debouncedTexts = useDebouncedValue(visibleTexts, 50);

  return (
    <>
      {debouncedTexts.map((t) => (
        <TextItem
          key={t.id}
          overlay={t}
          frameWidthPx={frameWidthPx}
          frameHeightPx={frameHeightPx}
          selected={selectedOverlayId === t.id}
          onSelect={() => setSelectedOverlayId(t.id)}
          onCommitPosition={(positionXFrac, positionYFrac) =>
            setOverlays((prev) => mutateOverlay(prev, t.id, { positionXFrac, positionYFrac }))
          }
        />
      ))}
    </>
  );
}

interface ItemProps {
  overlay: TextOverlay;
  frameWidthPx: number;
  frameHeightPx: number;
  selected: boolean;
  onSelect: () => void;
  onCommitPosition: (xFrac: number, yFrac: number) => void;
}

function TextItem({ overlay, frameWidthPx, frameHeightPx, selected, onSelect, onCommitPosition }: ItemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [boxPx, setBoxPx] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [dragStart, setDragStart] = useState<{ pointerX: number; pointerY: number; xFrac: number; yFrac: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio ?? 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const measureBox = computeOverlayPixelBox(ctx, overlay.text || "Edit text…", overlay, frameWidthPx, frameHeightPx);
    canvas.width = Math.max(1, measureBox.width) * dpr;
    canvas.height = Math.max(1, measureBox.height) * dpr;
    canvas.style.width = `${measureBox.width}px`;
    canvas.style.height = `${measureBox.height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTextOverlay(ctx, overlay.text || "Edit text…", overlay, frameWidthPx, frameHeightPx);
    setBoxPx({ x: measureBox.x, y: measureBox.y, w: measureBox.width, h: measureBox.height });
  }, [overlay, frameWidthPx, frameHeightPx]);

  useEffect(() => {
    if (!dragStart) return;
    function onMove(e: PointerEvent) {
      if (!dragStart) return;
      const dxFrac = (e.clientX - dragStart.pointerX) / frameWidthPx;
      const dyFrac = (e.clientY - dragStart.pointerY) / frameHeightPx;
      let newX = dragStart.xFrac + dxFrac;
      let newY = dragStart.yFrac + dyFrac;
      // Snap.
      const snapThresholdXFrac = TEXT_OVERLAY_SNAP_THRESHOLD_PX / frameWidthPx;
      const snapThresholdYFrac = TEXT_OVERLAY_SNAP_THRESHOLD_PX / frameHeightPx;
      for (const axis of TEXT_OVERLAY_SNAP_AXES) {
        if (Math.abs(newX - axis) < snapThresholdXFrac) newX = axis;
        if (Math.abs(newY - axis) < snapThresholdYFrac) newY = axis;
      }
      onCommitPosition(Math.max(0.02, Math.min(0.98, newX)), Math.max(0.02, Math.min(0.98, newY)));
    }
    function onUp() { setDragStart(null); }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [dragStart, frameWidthPx, frameHeightPx, onCommitPosition]);

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    onSelect();
    if (!selected) return;
    setDragStart({
      pointerX: e.clientX, pointerY: e.clientY,
      xFrac: overlay.positionXFrac, yFrac: overlay.positionYFrac,
    });
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={selected ? "absolute outline outline-2 outline-orange-400 outline-offset-2 cursor-move" : "absolute cursor-pointer"}
      style={{
        left: `${boxPx.x}px`, top: `${boxPx.y}px`,
        width: `${boxPx.w}px`, height: `${boxPx.h}px`,
      }}
    >
      <canvas ref={canvasRef} className="block pointer-events-none" />
    </div>
  );
}
```

- [ ] **Step 2: Mount inside the preview frame**

In `src/components/editor/preview/preview-player.tsx`:

Add import near the existing imports:

```ts
import { TextOverlayLayer } from "./text-overlay-layer";
```

Add a `useRef` for the preview frame and a measurement state (top of the component, around line 50):

```ts
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!previewFrameRef.current) return;
    const el = previewFrameRef.current;
    const ro = new ResizeObserver(() => {
      setFrameSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setFrameSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
```

Then in the JSX, attach the ref to the preview frame div (line ~420):

```tsx
      <div
        ref={previewFrameRef}
        className="bg-black rounded overflow-hidden flex items-center justify-center relative"
        style={{ aspectRatio: "4 / 5", height: "calc(100% - 48px)", maxWidth: "100%" }}
      >
        {/* ...existing children unchanged... */}
        {frameSize.width > 0 && frameSize.height > 0 && (
          <TextOverlayLayer frameWidthPx={frameSize.width} frameHeightPx={frameSize.height} />
        )}
      </div>
```

- [ ] **Step 3: Manual smoke check**

Run: `pnpm dev`. Add audio + script. Click "Generate captions". Press play. As playhead moves, the appropriate caption renders on the preview at bottom-center. Click a block in the timeline row → preview text gets an outline. Drag preview text → position updates.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/preview/text-overlay-layer.tsx src/components/editor/preview/preview-player.tsx
git commit -m "feat(text-overlay): canvas-rendered preview layer with drag-to-position"
```

---

## Task 11: Export — render captions into MP4

**Files:**
- Modify: `src/components/editor/dialogs/export-dialog.tsx`
- Modify: `src/components/build/render-trigger.tsx`
- Modify: `src/workers/render-worker.ts`

We pre-render every TextOverlay's PNG on the main thread, then post it to the worker along with timing + pixel position. The worker's final-mux step receives `captions: { pngBytes, startMs, endMs, xPx, yPx }[]` and chains `overlay` filters with `enable='between(t,start,end)'`.

- [ ] **Step 1: Add "Include captions" checkbox to export dialog**

In `src/components/editor/dialogs/export-dialog.tsx`, add a checkbox above the `RenderTrigger`. The dialog body currently renders `<RenderTrigger />`. Wrap it in local state and pass `includeCaptions` down:

```tsx
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBuildState } from "@/components/build/build-state-context";
import { RenderTrigger } from "@/components/build/render-trigger";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const { canExport, overlays } = useBuildState();
  const hasCaptions = overlays.some((o) => o.kind === "text");
  const [includeCaptions, setIncludeCaptions] = useState(true);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Export video</DialogTitle></DialogHeader>
        {canExport ? (
          <div className="space-y-3">
            {hasCaptions && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeCaptions}
                  onChange={(e) => setIncludeCaptions(e.target.checked)}
                />
                Include captions
              </label>
            )}
            <RenderTrigger includeCaptions={includeCaptions && hasCaptions} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Audio + script required to export.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add caption pre-render and worker message in `<RenderTrigger>`**

Open `src/components/build/render-trigger.tsx` and find the place where the worker `postMessage({ type: "render", ... })` happens. Add a `includeCaptions` prop to the component, and before posting to the worker, do:

```ts
import { renderTextOverlayToPNGBytes, computeOverlayPixelBox } from "@/lib/text-overlay/text-overlay-render";
import type { TextOverlay } from "@/lib/overlay/overlay-types";

// Inside the function that triggers render, after we know outputWidthPx/outputHeightPx:
async function buildCaptionPayload(
  texts: TextOverlay[],
  outW: number,
  outH: number,
): Promise<Array<{ pngBytes: Uint8Array; startMs: number; endMs: number; xPx: number; yPx: number }>> {
  const out: Array<{ pngBytes: Uint8Array; startMs: number; endMs: number; xPx: number; yPx: number }> = [];
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  if (!measureCtx) return out;
  for (const t of texts) {
    const box = computeOverlayPixelBox(measureCtx, t.text || "", t, outW, outH);
    const { bytes } = await renderTextOverlayToPNGBytes(t.text || "", t, outW, outH);
    out.push({
      pngBytes: bytes,
      startMs: t.startMs,
      endMs: t.startMs + t.durationMs,
      xPx: box.x,
      yPx: box.y,
    });
  }
  return out;
}

// where you call worker.postMessage({ type: "render", ... }):
const texts = includeCaptions
  ? overlays.filter((o): o is TextOverlay => o.kind === "text")
  : [];
const captions = await buildCaptionPayload(texts, outputWidthPx, outputHeightPx);
worker.postMessage({ type: "render", /* existing fields */, captions }, [
  /* existing transfers */, ...captions.map((c) => c.pngBytes.buffer),
]);
```

The exact placement depends on the existing structure of `render-trigger.tsx`. Read the file first; the `postMessage` and the dimension variables (`outputWidthPx`, `outputHeightPx`) already exist for the b-roll path. Wire `includeCaptions` as a prop on the component and thread it through.

- [ ] **Step 3: Extend the worker's render message type and final mux**

In `src/workers/render-worker.ts`:

Find the `type RenderMsg` (or wherever the incoming message is typed) and add:

```ts
interface CaptionPayload {
  pngBytes: ArrayBufferLike;  // transferred
  startMs: number;
  endMs: number;
  xPx: number;
  yPx: number;
}
// in the message:
//   captions?: CaptionPayload[];
```

In the final-mux block at the end of the render function (currently around line 244-257), replace the single `ffmpeg.exec` call with caption-aware version. Conceptually:

```ts
const captions: CaptionPayload[] = msg.captions ?? [];

await ffmpeg.writeFile("final.ts", finalTsBytes);
await ffmpeg.writeFile("audio.mp3", new Uint8Array(audioBuffer));

if (captions.length === 0) {
  await ffmpeg.exec([
    "-y", "-i", "final.ts", "-i", "audio.mp3",
    "-c:v", "copy", "-c:a", "aac", "-shortest", "output.mp4",
  ]);
} else {
  // Write each PNG.
  const captionInputs: string[] = [];
  for (let i = 0; i < captions.length; i++) {
    const name = `cap${i}.png`;
    await ffmpeg.writeFile(name, new Uint8Array(captions[i]!.pngBytes));
    captionInputs.push("-i", name);
  }
  // Build filter_complex: chain overlays.
  // [0:v][1:v]overlay=...:enable='between(t,a,b)'[v1];[v1][2:v]overlay=...[v2];...
  const filterParts: string[] = [];
  let prev = "0:v";
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i]!;
    const next = i === captions.length - 1 ? "vout" : `v${i + 1}`;
    const inputIdx = i + 2; // 0=video, 1=audio, captions start at index 2
    const startSec = (c.startMs / 1000).toFixed(3);
    const endSec = (c.endMs / 1000).toFixed(3);
    filterParts.push(
      `[${prev}][${inputIdx}:v]overlay=${c.xPx}:${c.yPx}:enable='between(t,${startSec},${endSec})'[${next}]`,
    );
    prev = next;
  }
  await ffmpeg.exec([
    "-y",
    "-i", "final.ts",
    "-i", "audio.mp3",
    ...captionInputs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[vout]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    "output.mp4",
  ]);
  // Cleanup PNGs.
  for (let i = 0; i < captions.length; i++) {
    try { await ffmpeg.deleteFile(`cap${i}.png`); } catch {}
  }
}
```

NOTE: previously the no-caption path used `-c:v copy` (zero re-encode). With captions, we MUST re-encode the video because we're applying a filter. The trade-off is acceptable — when no captions, we keep the fast-copy path.

- [ ] **Step 4: Update the worker message handler signature**

In the `self.onmessage` (or `addEventListener("message", ...)`) handler at top of `render-worker.ts`, ensure `captions` is destructured and threaded into the function. The exact line depends on the existing handler — search for the line that extracts `audioBuffer`, `outputWidthPx`, etc., and add `captions` alongside.

- [ ] **Step 5: Manual smoke check**

Run: `pnpm dev`. Load audio + script + b-roll. Generate captions. Click Export.

1. With "Include captions" ON → exported MP4 has captions burned in.
2. With "Include captions" OFF → exported MP4 has no captions (and re-uses the fast `-c:v copy` path).

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/dialogs/export-dialog.tsx \
        src/components/build/render-trigger.tsx \
        src/workers/render-worker.ts
git commit -m "feat(text-overlay): burn captions into exported MP4 via ffmpeg overlay filter"
```

---

## Task 12: INDEX.md docs

**Files:**
- Create: `src/lib/text-overlay/INDEX.md`
- Modify: `src/components/editor/overlay/INDEX.md`
- Modify: `src/lib/overlay/INDEX.md`

- [ ] **Step 1: Create text-overlay lib INDEX**

Create `src/lib/text-overlay/INDEX.md`:

```markdown
# Text overlay — lib INDEX

Pure logic for text-caption overlays. UI lives under `src/components/editor/timeline/track-text-overlays.tsx`, `src/components/editor/overlay/text-overlay-inspector.tsx`, and `src/components/editor/preview/text-overlay-layer.tsx`.

## I want to fix...

| Bug / change request                              | File                                                  |
| ------------------------------------------------- | ----------------------------------------------------- |
| Default style (font, size, color, position, BG)  | `text-style-defaults.ts` (`DEFAULT_TEXT_STYLE`)       |
| Re-generate from script (merge vs replace)       | `text-overlay-store.ts` (`mergeCaptions`)             |
| Overlap snap behavior                             | `text-overlay-store.ts` (`snapToNeighbor`)            |
| Canvas word-wrap                                  | `text-overlay-render.ts` (`wrapTextToLines`)          |
| Canvas → PNG bytes for export                     | `text-overlay-render.ts` (`renderTextOverlayToPNGBytes`) |
| Add a new fontFamily                              | `text-style-defaults.ts` (`AVAILABLE_FONTS`) + `public/fonts/` + `src/app/globals.css` |

## Data flow

```
Script paste → ParsedSection[]
   → "Generate captions" button → generateFromSections / mergeCaptions
       → BuildState.overlays (TextOverlay items, kind="text")
           → Preview: <TextOverlayLayer> uses renderTextOverlayToCanvas on a <canvas>
           → Export: <RenderTrigger> calls renderTextOverlayToPNGBytes per overlay
                → worker overlays PNGs via ffmpeg `overlay` filter with enable='between(t,a,b)'
```

## Concept reference

- **TextOverlay:** discriminated variant `kind: "text"` in the shared `OverlayItem` union. Lives in the same `overlays` array as b-roll overlays but ignores `trackIndex` semantics.
- **fontSizeFrac / positionXFrac / positionYFrac / maxWidthFrac:** all `0..1` relative to OUTPUT dimensions, so aspect-ratio changes don't break layout.
- **source:** `"auto-script"` (linked to a script section via `sectionLineNumber`) or `"manual"` (created via "+ Add text"). Merge logic depends on this.

## Testing

`pnpm test src/lib/text-overlay/`
```

- [ ] **Step 2: Update overlay UI INDEX**

Append to `src/components/editor/overlay/INDEX.md` under the Files table:

```markdown
| `text-overlay-inspector.tsx` | Sidebar form for the selected TextOverlay (apply-all, textarea, font, size, color, BG, stroke, position). |
```

And under the component tree, add:

```
EditorShell
└── ... (existing) ...
    ├── PreviewPlayer
    │   └── TextOverlayLayer       (renders <canvas> per active TextOverlay)
    └── TimelinePanel
        ├── TrackTextOverlays       (drag/resize text overlay blocks)
        └── ... (existing tracks) ...
```

- [ ] **Step 3: Update overlay lib INDEX**

Append to `src/lib/overlay/INDEX.md` under "I want to fix":

```markdown
| Track compaction not ignoring text overlays           | `overlay-store.ts` (`compactTracks` filters to `kind: "broll-video"`)      |
| Text overlays appearing in b-roll z-stack             | `overlay-render-plan.ts` (filters to `BrollVideoOverlay`)                 |
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/text-overlay/INDEX.md src/components/editor/overlay/INDEX.md src/lib/overlay/INDEX.md
git commit -m "docs(text-overlay): add INDEX.md files and update overlay docs"
```

---

## Self-review checklist

- ✅ **Data model:** `TextOverlay` added to `OverlayItem` union; `compactTracks`/`addOverlayWithNewTrack` made kind-aware.
- ✅ **Auto-generate trigger:** manual button (`GenerateCaptionsButton`), confirm dialog when overlays exist.
- ✅ **UI row position:** new `TrackTextOverlays` mounted between Ruler and TrackTags.
- ✅ **Block UX:** drag/resize/select; Delete handled by existing `use-overlay-keyboard.ts`.
- ✅ **Overlap policy:** `snapToNeighbor` clamps to neighbor edge — block UI calls it on every drag tick.
- ✅ **Inspector:** Apply-all toggle (sticky in `BuildState` + localStorage), textarea, font, size, color, BG, stroke, position — propagation correctness covered by `applyStyleToAll` test.
- ✅ **Manual add:** `AddTextButton` creates overlay at playhead with style copied from last-edited.
- ✅ **Style defaults match mock:** white BG, black text, Inter "Classic" font, rounded pill.
- ✅ **Preview render = export render:** both call `computeOverlayPixelBox` + `drawTextOverlay`; PNG path uses `renderTextOverlayToPNGBytes`. Output cropped tightly so ffmpeg `overlay` x/y align to pixel box.
- ✅ **Aspect ratio change:** positions and font size stored as fractions of output → automatically valid across aspect changes.
- ✅ **Export toggle:** `Include captions` checkbox in `ExportDialog`; OFF keeps the fast `-c:v copy` path.
- ✅ **Persistence:** Apply-all toggle persists; overlays themselves keep current in-memory behavior (no change requested for v1).
- ✅ **Test coverage:** style defaults, kind-aware overlay store, text-overlay store (generate, merge replace+merge, manual add, applyStyleToAll, snapToNeighbor), renderer (wrap, geometry).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-text-overlay.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
