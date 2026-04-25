# Clip File Name Search — Design Spec

**Date:** 2026-04-25
**Status:** Approved

## Overview

Add a clip file name search input to the main pane of the B-roll Library. Users can type to filter clips by `brollName` or `filename` across all folders, independent of the folder selection in the sidebar.

## Requirements

- Search matches against both `brollName` and `filename` fields (case-insensitive, substring match).
- Search across **all clips** regardless of the currently selected folder.
- Typing a query auto-switches the sidebar to "All clips" view (`activeFolderId = null`).
- Clearing the query leaves the sidebar on "All clips" (no folder restore).
- Live filter as the user types — no submit button.
- Show a "N clips match" counter below the input when a query is active.
- Grouped-by-base-name layout is preserved in results.
- Empty state: "No clips match '[query]'" when zero results.

## Architecture

### State

`fileQuery: string` (initialized `""`) lives in `WorkspacePage` (`src/app/dashboard/[productId]/page.tsx`).

### Data Flow

`displayedClips` derivation in `WorkspacePage`:

```
if fileQuery is non-empty:
  filter ALL clips where brollName or filename contains fileQuery (case-insensitive)
  ensure activeFolderId = null (auto-switch to All clips)
else:
  apply existing folder filter (folderId === activeFolderId, or all if null)
```

The auto-switch side effect runs inside the `fileQuery` setter via a handler function:

```ts
function handleFileQueryChange(q: string) {
  setFileQuery(q);
  if (q.trim()) setActiveFolderId(null);
}
```

### Props Added to ClipGrid

```ts
fileQuery: string
onFileQueryChange: (q: string) => void
```

## UI

### Placement

Top bar of the `ClipGrid` main pane — the area to the left of the existing "Upload Clips" button (the empty red-rectangle area in the original screenshot).

Layout: a single `flex justify-between items-center` row:
- **Left:** Search icon + Input (`h-7 text-sm pl-7`, placeholder "Search clips by name...")
- **Right:** Upload Clips button (existing, moved into this row)

Below the input, when `fileQuery` is active:
```
<span class="text-xs text-muted-foreground">{count} clips match</span>
```

### Empty State

When `fileQuery` is non-empty and zero clips match:
```
No clips match "{fileQuery}"
```

Same style as the folder search empty state.

### Upload Button Visibility

Unchanged: Upload button only shows when `activeFolderId !== null`. Since search auto-sets `activeFolderId = null`, the button hides during search — correct behavior.

## Files Changed

| File | Change |
|------|--------|
| `src/app/dashboard/[productId]/page.tsx` | Add `fileQuery` state, `handleFileQueryChange`, update `displayedClips` derivation, pass new props to `ClipGrid` |
| `src/components/broll/clip-grid.tsx` | Accept `fileQuery` / `onFileQueryChange` props, render search input in top bar, show match counter, update empty state |

## Out of Scope

- Folder search and clip file search remain independent — no cross-linking.
- No URL persistence of the search query.
- No server-side search — all filtering is client-side on already-loaded clips.
