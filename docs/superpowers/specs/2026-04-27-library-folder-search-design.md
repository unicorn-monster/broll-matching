# Library Folder Search

**Date:** 2026-04-27
**Status:** Design

## Problem

The library panel currently shows a flat grid of folders ([folders-grid.tsx](../../../src/components/editor/library/folders-grid.tsx)). When the user has many folders (e.g., the active product has ~10 already), finding one by eye is slow. Users want to filter folders by name from the header.

## Goal

Add a search input to the folders-grid header that filters the visible folder tiles by name (case-insensitive substring match).

## Non-Goals

- Searching clip filenames (clip-level filename search already exists in `ClipGrid`).
- Fuzzy matching, ranking, or recent-search history.
- Persisting the query across folder navigation.

## UX

**Location:** Inside the folders-grid header bar at [folders-grid.tsx:46-56](../../../src/components/editor/library/folders-grid.tsx#L46-L56). Layout becomes:

```
[ LIBRARY ]   [ 🔍 Search folders…           ]   [ + New ]
```

- The label stays fixed-width on the left.
- The search input takes available space (`flex-1`).
- The "New" button stays right-aligned.
- A `lucide-react` `Search` icon prefixes the input.
- Pressing `Escape` while focused clears the query.

**Filtering rules:**

- Trimmed empty query → show all folders.
- Non-empty query → show folders where `name.toLowerCase().includes(query.trim().toLowerCase())`.
- "All clips" tile (the neutral tile at the start of the grid) always renders, regardless of query.
- The in-progress "create folder" tile (rendered when `creating === true`) always renders, regardless of query, so the user can search and then immediately create without losing context.
- No "no results" empty-state message when zero folders match — the All-clips tile and create form already provide sufficient context.

## Implementation

**Component scope:** All changes are inside [folders-grid.tsx](../../../src/components/editor/library/folders-grid.tsx). No prop changes, no parent changes ([library-panel.tsx](../../../src/components/editor/library/library-panel.tsx) is unaffected).

**State:** Add a single `useState<string>("")` for `query` inside `FoldersGrid`. State stays local — `LibraryPanel` does not need to know.

**Render:**

1. Header gains an `<input>` with a leading `Search` icon, controlled by `query`.
2. The mapped `folders` list is replaced with a derived `visibleFolders` computed inline:
   ```ts
   const q = query.trim().toLowerCase();
   const visibleFolders = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders;
   ```
3. The render loop iterates `visibleFolders` instead of `folders`. The `All clips` tile and the `creating` tile are unaffected.

**Performance:** Filtering an array of folders (typically <50) on every keystroke is trivially cheap. No debounce, no `useMemo`.

**Styling:** Match existing header chrome — `text-xs`, muted background, border on focus, consistent with the surrounding dark theme. Use Tailwind utility classes already used elsewhere in this file.

## Testing

Add a single RTL test file `folders-grid.test.tsx` (or add cases to an existing one if present) covering:

1. Typing into the search input filters folder tiles by name (case-insensitive).
2. The "All clips" tile remains visible while a query is active.
3. Clearing the query (or `Escape`) restores the full folder list.
4. The "New" / create-folder flow remains usable while a query is active.

## Risks

None significant. Pure UI state, no data layer changes, no API surface changes.
