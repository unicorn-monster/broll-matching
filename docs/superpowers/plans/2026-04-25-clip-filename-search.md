# Clip File Name Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live search input to the clip grid that filters all clips by `brollName` or `filename`, auto-switching the sidebar to "All clips" when a query is active.

**Architecture:** `fileQuery` state lives in `WorkspacePage`; a `handleFileQueryChange` setter auto-sets `activeFolderId` to `null` when a query is typed. The filtering logic is extracted to a pure function in `src/lib/clip-filter.ts` so it can be unit-tested. `ClipGrid` receives `fileQuery`/`onFileQueryChange` props and renders the search input + match counter in its top bar.

**Tech Stack:** Next.js App Router, React, Vitest, Tailwind, shadcn/ui `Input`, lucide-react `Search` + `X`

---

### Task 1: Extract clip filter logic to a testable pure function

**Files:**
- Create: `src/lib/clip-filter.ts`
- Create: `src/lib/__tests__/clip-filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/clip-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filterClipsByQuery } from "../clip-filter";

type Clip = { id: string; brollName: string; filename: string; durationMs: number; indexeddbKey: string; folderId: string };

const clips: Clip[] = [
  { id: "1", brollName: "ump-clipper-compressthenail-01", filename: "clip_compress.mp4", durationMs: 3710, indexeddbKey: "k1", folderId: "f1" },
  { id: "2", brollName: "ump-clipper-cutthequick-01",    filename: "clip_cut.mp4",      durationMs: 5080, indexeddbKey: "k2", folderId: "f1" },
  { id: "3", brollName: "fs-dremel-loadnshake-01",       filename: "dremel_load.mov",   durationMs: 2000, indexeddbKey: "k3", folderId: "f2" },
];

describe("filterClipsByQuery", () => {
  it("returns all clips when query is empty", () => {
    expect(filterClipsByQuery(clips, "")).toEqual(clips);
  });

  it("returns all clips when query is whitespace only", () => {
    expect(filterClipsByQuery(clips, "   ")).toEqual(clips);
  });

  it("matches brollName case-insensitively", () => {
    const result = filterClipsByQuery(clips, "CLIPPER");
    expect(result.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("matches filename case-insensitively", () => {
    const result = filterClipsByQuery(clips, "dremel");
    expect(result.map((c) => c.id)).toEqual(["3"]);
  });

  it("matches filename when brollName does not match", () => {
    const result = filterClipsByQuery(clips, "clip_cut");
    expect(result.map((c) => c.id)).toEqual(["2"]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterClipsByQuery(clips, "zzzzzz")).toEqual([]);
  });

  it("matches substring", () => {
    const result = filterClipsByQuery(clips, "nail");
    expect(result.map((c) => c.id)).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm test src/lib/__tests__/clip-filter.test.ts
```

Expected: FAIL — `Cannot find module '../clip-filter'`

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/clip-filter.ts`:

```ts
type ClipLike = { brollName: string; filename: string };

export function filterClipsByQuery<T extends ClipLike>(clips: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return clips;
  return clips.filter(
    (c) => c.brollName.toLowerCase().includes(q) || c.filename.toLowerCase().includes(q)
  );
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test src/lib/__tests__/clip-filter.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/clip-filter.ts src/lib/__tests__/clip-filter.test.ts
git commit -m "feat: extract filterClipsByQuery pure function with tests"
```

---

### Task 2: Add fileQuery state to WorkspacePage and wire up displayedClips

**Files:**
- Modify: `src/app/dashboard/[productId]/page.tsx`

- [ ] **Step 1: Add state and handler**

In `src/app/dashboard/[productId]/page.tsx`, add the import and state:

```ts
// Add to imports at top
import { filterClipsByQuery } from "@/lib/clip-filter";
```

Inside `WorkspacePage`, after the existing `useState` declarations (line 17):

```ts
const [fileQuery, setFileQuery] = useState("");

function handleFileQueryChange(q: string) {
  setFileQuery(q);
  if (q.trim()) setActiveFolderId(null);
}
```

- [ ] **Step 2: Update displayedClips derivation**

Replace the existing `displayedClips` lines (currently lines 67-69):

```ts
// Before:
const displayedClips = activeFolderId
  ? clips.filter((c) => c.folderId === activeFolderId)
  : clips;
```

```ts
// After:
const displayedClips = fileQuery.trim()
  ? filterClipsByQuery(clips, fileQuery)
  : activeFolderId
    ? clips.filter((c) => c.folderId === activeFolderId)
    : clips;
```

- [ ] **Step 3: Pass new props to ClipGrid**

In the `<ClipGrid>` JSX (currently around line 83), add two props:

```tsx
<ClipGrid
  clips={displayedClips}
  productId={productId}
  folders={folders}
  activeFolderId={activeFolderId}
  onClipsChanged={loadAllClips}
  fileQuery={fileQuery}
  onFileQueryChange={handleFileQueryChange}
/>
```

- [ ] **Step 4: Verify the page TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: errors about ClipGrid not accepting the new props yet (that's fine — fix in Task 3). If there are unexpected errors unrelated to the new props, fix them now.

- [ ] **Step 5: Commit (partial — page side)**

```bash
git add src/app/dashboard/[productId]/page.tsx
git commit -m "feat: add fileQuery state and auto-folder-switch to WorkspacePage"
```

---

### Task 3: Update ClipGrid to accept props and render the search UI

**Files:**
- Modify: `src/components/broll/clip-grid.tsx`

- [ ] **Step 1: Update ClipGridProps interface**

In `src/components/broll/clip-grid.tsx`, update the `ClipGridProps` interface (currently lines 19-24):

```ts
interface ClipGridProps {
  clips: Clip[];
  productId: string;
  folders: Folder[];
  activeFolderId: string | null;
  onClipsChanged: () => void;
  fileQuery: string;
  onFileQueryChange: (q: string) => void;
}
```

- [ ] **Step 2: Destructure new props in ClipGrid function**

Update the function signature (currently line 38):

```ts
export function ClipGrid({ clips, productId, folders, activeFolderId, onClipsChanged, fileQuery, onFileQueryChange }: ClipGridProps) {
```

- [ ] **Step 3: Add Search icon import**

At the top of the file, update the lucide-react import (currently line 4):

```ts
import { Trash2, Pencil, Upload, Search, X } from "lucide-react";
```

- [ ] **Step 4: Add the search input bar to the JSX**

The main `return` currently starts with a `<div className="space-y-6">`. Replace it so the top bar is always rendered (even when clips is empty after the early return):

Remove the early-return empty state block (currently lines 74-83) and replace the main `return` with:

```tsx
return (
  <div className="space-y-6">
    {/* Top bar: search + upload */}
    <div className="flex items-center justify-between gap-3">
      <div className="relative flex-1 max-w-xs">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={fileQuery}
          onChange={(e) => onFileQueryChange(e.target.value)}
          placeholder="Search clips by name..."
          className="h-7 text-sm pl-7 pr-7"
        />
        {fileQuery && (
          <button
            onClick={() => onFileQueryChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {activeFolderId && (
        <Button variant="outline" onClick={() => setShowUpload((v) => !v)}>
          <Upload className="w-4 h-4 mr-2" />{showUpload ? "Hide Upload" : "Upload Clips"}
        </Button>
      )}
    </div>

    {/* Match counter */}
    {fileQuery.trim() && (
      <p className="text-xs text-muted-foreground -mt-4">
        {clips.length} {clips.length === 1 ? "clip" : "clips"} match
      </p>
    )}

    {/* Upload panel */}
    {showUpload && activeFolderId && (
      <ClipUpload
        productId={productId}
        folderId={activeFolderId}
        onDone={() => { setShowUpload(false); onClipsChanged(); }}
      />
    )}

    {/* Empty states */}
    {clips.length === 0 && fileQuery.trim() && (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p>No clips match &ldquo;{fileQuery}&rdquo;</p>
      </div>
    )}
    {clips.length === 0 && !fileQuery.trim() && (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
        <p>{activeFolderId ? "No clips in this folder." : "No clips yet."}</p>
        {activeFolderId && (
          <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4 mr-2" />Upload Clips</Button>
        )}
      </div>
    )}

    {/* Clip groups */}
    {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([base, groupClips]) => (
      <div key={base}>
        <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
          {base}
          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{groupClips.length}</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {groupClips.map((clip) => (
            <div key={clip.id} className="group relative border border-border rounded-lg overflow-hidden bg-muted/20">
              <div className="aspect-[4/5] relative">
                <ThumbnailImage clipId={clip.indexeddbKey} />
                <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1 rounded">
                  {formatMs(clip.durationMs)}
                </div>
              </div>
              <div className="p-1.5">
                {editingId === clip.id ? (
                  <div className="flex gap-1">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(clip);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="h-6 text-xs"
                    />
                    <button onClick={() => handleRename(clip)} className="text-xs text-green-600">✓</button>
                  </div>
                ) : (
                  <p className="text-xs truncate font-mono">{clip.brollName}</p>
                )}
              </div>
              <div className="absolute top-1 right-1 hidden group-hover:flex gap-1 bg-black/60 rounded p-0.5">
                <button
                  onClick={() => { setEditingId(clip.id); setEditName(clip.brollName); }}
                  className="text-white hover:text-yellow-300"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={() => handleDelete(clip)} className="text-white hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);
```

- [ ] **Step 5: Verify TypeScript compiles clean**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Run all tests**

```bash
pnpm test
```

Expected: all tests pass (including the 7 new clip-filter tests)

- [ ] **Step 7: Smoke test in browser**

Start the dev server if not running:

```bash
pnpm dev
```

Open the B-roll Library page. Verify:
1. Search input appears in the top bar to the left of the "Upload Clips" button.
2. Typing "ump" filters to only UMP clips; the sidebar switches to "All clips".
3. The match counter shows the correct count.
4. Clearing the input (X button or backspace) removes the filter; sidebar stays on "All clips".
5. Typing a query that matches nothing shows `No clips match "..."`.
6. Upload button hides while search is active (since `activeFolderId` becomes null).
7. Selecting a folder after clearing search works normally.

- [ ] **Step 8: Commit**

```bash
git add src/components/broll/clip-grid.tsx
git commit -m "feat: add clip filename search input to clip grid"
```
