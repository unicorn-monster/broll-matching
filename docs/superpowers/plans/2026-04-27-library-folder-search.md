# Library Folder Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a case-insensitive search input to the library folders header that filters visible folder tiles by name.

**Architecture:** Two units. (1) A pure helper `filterFoldersByName` in `src/lib/folder-filter.ts`, unit-tested with vitest, mirroring the established `clip-filter.ts` pattern. (2) `FoldersGrid` gains local `query` state, an `<input>` in its header, and renders `filterFoldersByName(folders, query)` instead of `folders`. The "All clips" tile and the in-progress "create folder" tile always render regardless of the query.

**Tech Stack:** React 19, Next.js 16 App Router, Tailwind CSS, lucide-react icons, Vitest 4 (node env).

**Spec:** [docs/superpowers/specs/2026-04-27-library-folder-search-design.md](../specs/2026-04-27-library-folder-search-design.md)

---

## File Structure

| Action | Path | Responsibility |
| ------ | ---- | -------------- |
| Create | `src/lib/folder-filter.ts` | Pure helper: filters a `{ name }[]` array by case-insensitive substring match against a query string |
| Create | `src/lib/__tests__/folder-filter.test.ts` | Vitest unit tests for `filterFoldersByName` |
| Modify | `src/components/editor/library/folders-grid.tsx` | Add `query` state, search input in header, use `filterFoldersByName` for the rendered folder list |

`library-panel.tsx` is unchanged — `FoldersGrid` keeps its existing props.

---

## Task 1: Pure filter helper (RED)

**Files:**
- Create: `src/lib/__tests__/folder-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/folder-filter.test.ts` with this exact content:

```ts
import { describe, it, expect } from "vitest";
import { filterFoldersByName } from "../folder-filter";

type Folder = { id: string; name: string; clipCount: number };

const folders: Folder[] = [
  { id: "f1", name: "FS-Clipper", clipCount: 11 },
  { id: "f2", name: "FS-Clipper-n-Dremel", clipCount: 1 },
  { id: "f3", name: "FS-Dremel", clipCount: 16 },
  { id: "f4", name: "Authority", clipCount: 0 },
  { id: "f5", name: "Before-after", clipCount: 6 },
];

describe("filterFoldersByName", () => {
  it("returns all folders when query is empty", () => {
    expect(filterFoldersByName(folders, "")).toEqual(folders);
  });

  it("returns all folders when query is whitespace only", () => {
    expect(filterFoldersByName(folders, "   ")).toEqual(folders);
  });

  it("matches name case-insensitively", () => {
    const result = filterFoldersByName(folders, "CLIPPER");
    expect(result.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("matches a substring within the name", () => {
    const result = filterFoldersByName(folders, "dremel");
    expect(result.map((f) => f.id)).toEqual(["f2", "f3"]);
  });

  it("trims surrounding whitespace before matching", () => {
    const result = filterFoldersByName(folders, "  authority  ");
    expect(result.map((f) => f.id)).toEqual(["f4"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterFoldersByName(folders, "zzzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/__tests__/folder-filter.test.ts`

Expected: FAIL — vitest cannot resolve `../folder-filter`. Error message should mention `folder-filter` not found / cannot find module.

---

## Task 2: Pure filter helper (GREEN)

**Files:**
- Create: `src/lib/folder-filter.ts`

- [ ] **Step 1: Write the minimal implementation**

Create `src/lib/folder-filter.ts` with this exact content:

```ts
type FolderLike = { name: string };

export function filterFoldersByName<T extends FolderLike>(folders: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return folders;
  return folders.filter((f) => f.name.toLowerCase().includes(q));
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test src/lib/__tests__/folder-filter.test.ts`

Expected: PASS — all 6 tests in the `filterFoldersByName` describe block pass.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS — no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/folder-filter.ts src/lib/__tests__/folder-filter.test.ts
git commit -m "feat(folder-filter): add filterFoldersByName helper

Mirrors the clip-filter pattern: pure, generic, case-insensitive
substring match on the name field. Used by the library folders grid
to power the new folder search input."
```

---

## Task 3: Wire search input into FoldersGrid

**Files:**
- Modify: `src/components/editor/library/folders-grid.tsx`

This task changes `FoldersGrid` in three coordinated edits: imports, header markup + state, and the render loop. Do all three before running checks.

- [ ] **Step 1: Update imports**

In `src/components/editor/library/folders-grid.tsx`, replace the existing imports block at the top of the file:

```tsx
"use client";

import { Folder, FolderPlus, Layers, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
```

with:

```tsx
"use client";

import { Folder, FolderPlus, Layers, MoreVertical, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { filterFoldersByName } from "@/lib/folder-filter";
```

(Two changes: add `Search` to the lucide import and add the `filterFoldersByName` import.)

- [ ] **Step 2: Add `query` state and a `visibleFolders` derivation inside `FoldersGrid`**

Find the existing state declarations at the start of the `FoldersGrid` function body:

```tsx
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
```

Replace them with:

```tsx
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");

  const visibleFolders = filterFoldersByName(folders, query);
```

- [ ] **Step 3: Replace the header bar to include the search input**

Find the existing header `<div>` (the one inside the outer `flex flex-col` div, immediately after the opening of the returned JSX):

```tsx
      <div className="flex items-center justify-between px-3 py-2 border-b border-border text-xs">
        <span className="font-medium text-muted-foreground uppercase tracking-wide">Library</span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="New folder"
        >
          <FolderPlus className="w-3.5 h-3.5" /> New
        </button>
      </div>
```

Replace it with:

```tsx
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <span className="font-medium text-muted-foreground uppercase tracking-wide shrink-0">Library</span>
        <div className="relative flex-1 min-w-0">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search folders…"
            aria-label="Search folders"
            className="w-full pl-6 pr-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          aria-label="New folder"
        >
          <FolderPlus className="w-3.5 h-3.5" /> New
        </button>
      </div>
```

(Changes: removed `justify-between`, added `gap-2`; added `shrink-0` to the label and to the New button; inserted a `flex-1 min-w-0` wrapper containing the Search icon + `<input>`. Escape clears the query.)

- [ ] **Step 4: Render `visibleFolders` instead of `folders` in the grid**

Find the existing folders mapping inside the grid (the `folders.map((f) => ( ... ))` block):

```tsx
          {folders.map((f) => (
            <FolderTile
              key={f.id}
              icon={<Folder className="w-10 h-10 fill-yellow-400 text-yellow-500" />}
              name={f.name}
              count={f.clipCount}
              tone="yellow"
              onClick={() => onSelect(f.id)}
              onRename={async () => {
                const next = prompt("Rename folder", f.name);
                if (next && next.trim() && next.trim() !== f.name) await onRename(f.id, next.trim());
              }}
              onDelete={async () => {
                if (confirm(`Delete folder "${f.name}" and all its clips?`)) await onDelete(f.id);
              }}
            />
          ))}
```

Replace `folders.map` with `visibleFolders.map`. Final form:

```tsx
          {visibleFolders.map((f) => (
            <FolderTile
              key={f.id}
              icon={<Folder className="w-10 h-10 fill-yellow-400 text-yellow-500" />}
              name={f.name}
              count={f.clipCount}
              tone="yellow"
              onClick={() => onSelect(f.id)}
              onRename={async () => {
                const next = prompt("Rename folder", f.name);
                if (next && next.trim() && next.trim() !== f.name) await onRename(f.id, next.trim());
              }}
              onDelete={async () => {
                if (confirm(`Delete folder "${f.name}" and all its clips?`)) await onDelete(f.id);
              }}
            />
          ))}
```

The `All clips` tile above this block and the `creating` form below it are unchanged — both always render regardless of the query, per spec.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm check`

Expected: PASS — no lint or type errors.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`

Expected: PASS — all existing tests plus the 6 new `filterFoldersByName` tests pass.

- [ ] **Step 7: Manually verify in the dev server**

Run: `pnpm dev` and open the editor for any product that has folders.

Verify each of the following in the library panel (folder grid view):

1. The header shows: `LIBRARY` label, a search input with magnifier icon and "Search folders…" placeholder, and the `+ New` button (in that left-to-right order).
2. Typing `clip` filters the folder tiles to only those whose name contains "clip" (case-insensitive).
3. The "All clips" tile remains visible at all times, including while a query is active.
4. Pressing `Escape` while focused on the input clears the query and restores the full folder list.
5. Clicking `+ New` while a query is active still opens the create-folder tile and lets you create a folder.
6. After clearing the query, all folders return.

If any check fails, fix the issue and re-run before committing.

- [ ] **Step 8: Commit**

```bash
git add src/components/editor/library/folders-grid.tsx
git commit -m "feat(library): folder search input in folders-grid header

Adds a case-insensitive folder name filter to the library header,
between the Library label and the New button. All clips and the
in-progress create-folder tiles always render regardless of query.
Escape clears the query."
```

---

## Self-review notes

- Spec coverage: helper extraction + tests (Tasks 1–2), search input + filtering + Escape-clears + All-clips/create always visible (Task 3). All spec requirements covered.
- No placeholders — every code block is complete and ready to paste.
- Type consistency: `filterFoldersByName` signature in Task 1 test, Task 2 implementation, and Task 3 import all match (`<T extends { name: string }>(folders: T[], query: string) => T[]`). The component-side `FolderTile` type satisfies the `{ name: string }` constraint.
