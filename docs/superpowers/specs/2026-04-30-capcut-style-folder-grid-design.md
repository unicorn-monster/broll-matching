# CapCut-Style Folder Grid for Library Panel

**Date:** 2026-04-30
**Branch:** `feat/srt-style-script-format`

## Problem

The current `LibraryPanel` renders a two-column layout — `FolderSidebar` on the left, `ClipGrid` on the right. The user finds this layout cramped and visually unappealing ("xấu điên") and wants a CapCut-style file browser:

- One single panel showing folder tiles in a 3-column grid.
- Each uploaded folder appears as a yellow folder icon.
- A neutral "All clips" tile is always the first tile.
- Click a folder tile to drill into it; a Back button returns to the grid.
- Clip search continues to work inside a folder.

A `FoldersGrid` component already implements the visual grid (yellow folders, "All clips" tile, grid-cols-3) but is not wired into `LibraryPanel`.

## Goal

Replace the sidebar+clips two-column layout with a single-panel drill-down navigation:

- **Default view:** folder grid (3 cols, yellow folders + neutral "All clips" tile first).
- **Drilled-in view:** Back button + folder name header + ClipGrid with search.
- All existing flows (folder upload, duplicate handling, invalid files, delete confirmation) continue to work unchanged.

## Non-goals

- No changes to `FolderSidebar` (left in repo; not used in editor anymore but other callers may exist — check during implementation).
- No changes to upload flow, picker, or dialogs.
- No changes to drag-and-drop from clips to overlay tracks.
- No changes to `media-pool` state shape.

## Design

### File scope

| File | Change |
|---|---|
| [src/components/editor/library/library-panel.tsx](src/components/editor/library/library-panel.tsx) | Rewrite: replace sidebar+clips with view state machine |
| [src/components/editor/library/folders-grid.tsx](src/components/editor/library/folders-grid.tsx) | Minor: swap "All clips" icon from `Layers` to `Folder` (white/neutral tone) for consistency; expose the upload-folder action via `onCreate` (currently only emits a name string — needs to also trigger the OS folder picker flow) |

### View state

```
view: "folders"  ──click folder tile──▶  view: "clips" (selectedFolderId | null)
                                              │
                                              └──click ← Back──▶  view: "folders"
```

State held locally in `LibraryPanel`:

```ts
const [view, setView] = useState<"folders" | "clips">("folders");
const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
```

`selectedFolderId === null` while in `"clips"` view means **All clips**.

The existing `mediaPool.activeFolderId` (used elsewhere?) — verify usage during implementation. If only `LibraryPanel` reads it, we can drop it in favor of local `selectedFolderId`. If other consumers exist, keep `activeFolderId` in sync.

### Folders view

Render `<FoldersGrid>` with:

- Header: `LIBRARY` label + folder-name search input + `+ New` button (triggers OS folder picker via existing `handleAdd`).
- Grid (3 cols):
  1. **All clips tile** — `Folder` icon, neutral tone, count = total clips, click → `setView("clips"); setSelectedFolderId(null)`.
  2. **Per-folder tiles** — yellow `Folder` icon, name, clip count, click → drill-in. Hover menu: Rename / Delete.
  3. **Empty state** — when no folders exist (only the "All clips" tile shows), render a small hint below the grid: "Click + New to upload your first folder."

### Clips view

Render a new lightweight header bar above `<ClipGrid>`:

```
[← Back]   [Folder Name]                    [N clips]
```

- `← Back` → `setView("folders")`.
- Folder Name = `"All clips"` if `selectedFolderId === null`, else folder name from `mediaPool.folders`.
- `N clips` = `visibleClips.length`.
- Below header: `<ClipGrid>` (its built-in search bar provides clip name lookup — no changes needed to ClipGrid).

`visibleClips` = `mediaPool.videos` filtered by `selectedFolderId` (null = all) then by `fileQuery`.

### Dialog wiring

All three dialogs remain rendered at the panel root (siblings of the view content), so they fire on either view:

- `DuplicateFolderDialog` — opens when user re-imports a colliding folder name.
- `InvalidFilesDialog` — opens after import if some files were skipped.
- `DeleteFolderDialog` — opens from the per-folder hover menu in the folders view.

After a successful folder upload, auto-navigate to the clips view of the new folder:
```ts
setSelectedFolderId(result.folderId);
setView("clips");
```

### `FoldersGrid` API tweak

Current `onCreate(name: string)` is meant for inline-create-empty-folder. Our flow needs **OS folder picker** instead. Two options:

- **A.** Replace `onCreate` with `onAdd: () => void` (matches `FolderSidebar` API) — `+ New` button triggers picker directly. Drop the inline-name-input flow.
- **B.** Keep both: rename `onCreate` to `onCreateEmpty` for inline create, add `onAdd` for picker.

Recommend **A**: the sidebar already used `onAdd` (picker), the inline empty-folder flow doesn't appear in the user's reference design. Less surface, less code.

## Testing

Manual verification (per `verification-before-completion`):

1. Open editor with no folders — see folders view with only "All clips" (count 0). Click "+ New" → picker opens.
2. Upload a folder of 5 videos — auto-navigates to clips view of that folder, shows 5 clips.
3. Click `← Back` → folders view, see 1 yellow folder + "All clips" tile (count 5).
4. Click "All clips" → clips view shows all 5 clips, header reads "All clips".
5. Type in clip search → matches filter, counter updates.
6. Upload a 2nd folder with the same name — duplicate dialog opens, choose "Merge" → clips view of merged folder.
7. From folders view, hover a folder → menu shows Rename / Delete. Delete → confirm dialog → folder gone.
8. Drag a clip from clips view onto overlay timeline — still works (no change to drag source).

Existing unit tests:
- `clip-filter.test.ts` — unchanged (filter logic untouched).
- `folder-filter.test.ts` — unchanged.
- `folder-name-collision.test.ts` — unchanged.

No new unit tests required: the change is wiring + a state machine. UI verification covers behavior.

## Risks

- **`mediaPool.activeFolderId` consumers** — if other components read this, dropping it breaks them. Check before refactor.
- **Drag source still references `clip.fileId`** — no risk; drill-down doesn't change clip data shape.
- **`FolderSidebar` left orphaned** — keep file in repo but verify no other importers; if none, deletion is a follow-up cleanup, not part of this change.

## Out of scope / follow-ups

- Drag-to-reorder folders.
- Multi-select clips across folders.
- Folder color customization.
- Removing the now-unused `FolderSidebar` component (separate cleanup PR).
