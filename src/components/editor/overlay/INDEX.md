# Overlay feature — UI INDEX

UI for overlay tracks. Pure logic lives under `src/lib/overlay/`. Spec: `docs/superpowers/specs/2026-04-28-overlay-tracks-v1-design.md`.

## I want to fix...

| Bug / change request                                  | File                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Drag from library not starting                       | `overlay-drag-source.ts` (and `clip-grid.tsx` wiring)      |
| Ghost preview wrong color / position                 | `overlay-tracks.tsx` (ghostVisual block)                   |
| Overlay block doesn't show thumbnail                 | `overlay-clip-block.tsx`                                   |
| Inspector slider not updating preview                | `overlay-inspector.tsx` (mutateOverlay) + `preview-player.tsx` (rAF reads overlays) |
| Keyboard shortcut not firing                         | `use-overlay-keyboard.ts` (text-field guard)               |
| Drop zone not appearing                              | `overlay-tracks.tsx` (`isDragging` check + collapse rules) |

## Component tree (when an overlay is selected)

```
EditorShell
└── OverlayDragProvider                       (overlay-drag-context)
    ├── LibraryPanel
    │   └── ClipGrid
    │       └── ClipTile                      (uses useOverlayDragSource)
    ├── PreviewPlayer                         (renders <video> per overlay)
    ├── OverlayInspector                      (column 3 row 2 when overlay selected)
    └── TimelinePanel
        └── OverlayTracks                     (drag target + clip block renderer)
            └── OverlayClipBlock              (per overlay, draggable)
```

## Files

| File                        | Role                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `overlay-drag-context.tsx`  | React context holding `dragInfo` (create vs. move) across subtree   |
| `overlay-drag-source.ts`    | Hook: wires ClipTile drag events → startDrag in context             |
| `overlay-tracks.tsx`        | Main drop target: renders tracks, ghost, handles drop/move/click    |
| `overlay-clip-block.tsx`    | Visual block per overlay on a track row                             |
| `overlay-inspector.tsx`     | Inspector panel: volume, mute, fade, delete for selected overlay    |
| `use-overlay-keyboard.ts`   | Keyboard: `C`=split, `Delete`/`Backspace`=delete, `Esc`=deselect   |
