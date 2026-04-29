# Overlay feature — lib INDEX

This folder holds **pure logic** for the overlay tracks feature. UI components live under `src/components/editor/overlay/`. See the spec at `docs/superpowers/specs/2026-04-28-overlay-tracks-v1-design.md`.

## I want to fix...

| Bug / change request                                  | File                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Snap not catching the playhead                        | `overlay-snap.ts`                                       |
| Snap priority order (playhead > section > edge)        | `overlay-snap.ts` (PRIORITY map)                        |
| Allow overlap on same track                           | `overlay-collision.ts`                                  |
| Track auto-compact behavior wrong                     | `overlay-store.ts` (`compactTracks`)                    |
| Split / move logic                                    | `overlay-store.ts`                                      |
| Volume / mute / fade computation per frame            | `overlay-render-plan.ts` (`computeFadedVolume`)         |
| Topmost overlay selection                             | `overlay-render-plan.ts` (`findTopmostActive`)          |
| Drop creates new track when it shouldn't              | `overlay-tracks.ts` (`pickTrack`)                       |
| Add a new field to `OverlayItem`                      | `overlay-types.ts`, then grep usages                    |

## Data flow

```
LibraryPanel (drag source via overlay-drag-source) → overlay-drag-context
  → TimelinePanel/OverlayTracks (drop target)
    → overlay-store reducers → BuildState.overlays
      → PreviewPlayer reads overlays + computes per-frame plan via overlay-render-plan
        → overlay-tracks.tsx UI updates from BuildState
```

## Concept reference

- **OverlayItem:** discriminated-union element on a free-form track. Only `BrollVideoOverlay` is implemented in v1; `audio-fx` and `text` are reserved type names.
- **trackIndex:** integer; 0 = lowest overlay (just above main), larger = on top of the render stack.
- **sourceStartMs / sourceDurationMs:** offset and length in the original clip; non-zero `sourceStartMs` happens after a split.
- **Half-open interval:** `[startMs, startMs+durationMs)` — overlay at exact end is NOT active.

## Testing

Each module has tests under `__tests__/`. Run them with `pnpm test src/lib/overlay/`.
