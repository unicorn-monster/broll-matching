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
  ctx.font = `${style.fontWeight} ${fontSizePx}px "${style.fontFamily}", sans-serif`;
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

// Per-line pill height matches the line-height so adjacent pills touch exactly
// (pill[i].bottom == pill[i+1].top) — no visible gap between stacked pills.
const PER_LINE_PILL_HEIGHT_MULTIPLIER = LINE_HEIGHT_MULTIPLIER;

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
  ctx.font = `${style.fontWeight} ${box.fontSizePx}px "${style.fontFamily}", sans-serif`;
  ctx.textBaseline = "top";

  if (style.bgMode === "block") {
    const radius = Math.min(
      Math.round(style.bgRadiusFrac * box.height),
      Math.round(box.height / 2),
    );
    ctx.fillStyle = hexWithOpacity(style.bgColor, style.bgOpacity);
    roundRect(ctx, box.x, box.y, box.width, box.height, radius);
    ctx.fill();
  } else if (style.bgMode === "per-line") {
    const pillHeight = Math.round(box.fontSizePx * PER_LINE_PILL_HEIGHT_MULTIPLIER);
    const pillVerticalOffset = Math.round((pillHeight - box.fontSizePx) / 2);
    ctx.fillStyle = hexWithOpacity(style.bgColor, style.bgOpacity);
    const pillRadius = Math.min(
      Math.round(style.bgRadiusFrac * pillHeight),
      Math.round(pillHeight / 2),
    );

    // First pass: compute each pill's pixel geometry so we can do smart corner detection.
    interface PillGeom { x: number; y: number; width: number; height: number }
    const pills: (PillGeom | null)[] = box.lines.map((line, i) => {
      if (line.length === 0) return null;
      const lineWidthPx = ctx.measureText(line).width;
      const pillWidth = Math.round(lineWidthPx + 2 * box.paddingXPx);
      let pillX: number;
      if (style.alignment === "left") {
        pillX = box.x;
      } else if (style.alignment === "right") {
        pillX = box.x + box.width - pillWidth;
      } else {
        pillX = box.x + Math.round((box.width - pillWidth) / 2);
      }
      const textY = box.y + box.paddingYPx + i * box.lineHeight;
      return { x: pillX, y: textY - pillVerticalOffset, width: pillWidth, height: pillHeight };
    });

    // Second pass: draw with corners rounded only when NOT covered by the adjacent pill.
    // A corner at column cx is "covered" by an adjacent pill that spans [adj.x, adj.x + adj.width]
    // if adj.x ≤ cx ≤ adj.x + adj.width. Covered corners are flat (so pills merge cleanly);
    // exposed corners stay rounded (so wings where pills differ in width still look soft).
    for (let i = 0; i < pills.length; i++) {
      const p = pills[i];
      if (!p) continue;
      const above = i > 0 ? pills[i - 1] : null;
      const below = i < pills.length - 1 ? pills[i + 1] : null;
      const leftX = p.x;
      const rightX = p.x + p.width;
      const tlCovered = above != null && above.x <= leftX && leftX <= above.x + above.width;
      const trCovered = above != null && above.x <= rightX && rightX <= above.x + above.width;
      const blCovered = below != null && below.x <= leftX && leftX <= below.x + below.width;
      const brCovered = below != null && below.x <= rightX && rightX <= below.x + below.width;
      const radii: CornerRadii = {
        tl: tlCovered ? 0 : pillRadius,
        tr: trCovered ? 0 : pillRadius,
        br: brCovered ? 0 : pillRadius,
        bl: blCovered ? 0 : pillRadius,
      };
      roundRect(ctx, p.x, p.y, p.width, p.height, radii);
      ctx.fill();
    }
  }

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

export interface CornerRadii { tl: number; tr: number; br: number; bl: number }

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number | CornerRadii,
) {
  const maxR = Math.min(w / 2, h / 2);
  const radii: CornerRadii = typeof r === "number"
    ? { tl: r, tr: r, br: r, bl: r }
    : r;
  const tl = Math.max(0, Math.min(radii.tl, maxR));
  const tr = Math.max(0, Math.min(radii.tr, maxR));
  const br = Math.max(0, Math.min(radii.br, maxR));
  const bl = Math.max(0, Math.min(radii.bl, maxR));
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
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
