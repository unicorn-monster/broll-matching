// Forces the browser to fetch every (family, weight) combination used by text overlays.
// CSS @font-face is lazy: a face only loads when an element references it. Canvas
// drawText falls back to sans-serif if its requested font isn't loaded — so we must
// pre-load explicitly so preview canvas, PNG export, and split-line measurement all
// hit the right font on first paint.

import { AVAILABLE_FONTS } from "./text-style-defaults";

const WEIGHTS = [400, 500, 600, 700] as const;

let inflight: Promise<void> | null = null;

export function preloadTextOverlayFonts(): Promise<void> {
  if (inflight) return inflight;
  if (typeof document === "undefined") return Promise.resolve();
  inflight = (async () => {
    const loads: Promise<unknown>[] = [];
    for (const f of AVAILABLE_FONTS) {
      for (const w of WEIGHTS) {
        // 50px is arbitrary — the size doesn't affect which file is fetched, only the match.
        loads.push(document.fonts.load(`${w} 50px "${f.id}"`).catch(() => undefined));
      }
    }
    await Promise.all(loads);
  })();
  return inflight;
}
