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
           → Preview: <TextOverlayLayer> uses drawTextOverlay on a <canvas>
           → Export: <RenderTrigger> calls renderTextOverlayToPNGBytes per overlay,
             POSTs PNGs + metadata to /api/render
                → server `route.ts` chains `overlay` filters with enable='between(t,a,b)'
```

## Concept reference

- **TextOverlay:** discriminated variant `kind: "text"` in the shared `OverlayItem` union. Lives in the same `overlays` array as b-roll overlays but ignores `trackIndex` semantics.
- **fontSizeFrac / positionXFrac / positionYFrac / maxWidthFrac:** all `0..1` relative to OUTPUT dimensions, so aspect-ratio changes don't break layout.
- **source:** `"auto-script"` (linked to a script section via `sectionLineNumber`) or `"manual"` (created via "+ Add text"). Merge logic depends on this.

## Testing

`pnpm test src/lib/text-overlay/`
