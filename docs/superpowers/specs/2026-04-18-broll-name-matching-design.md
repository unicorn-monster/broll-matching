# Design: B-Roll Name–Based Matching

## Context

Replace the current folder-based B-roll matching with a B-roll name–based matching system. Folders become pure UI organization; auto-match relies solely on B-roll names and their base name (prefix before the numeric variant suffix).

This supersedes the matching-related portions of `specs/broll-auto-assembly/requirements.md` and `implementation-plan.md`.

## Problem

Current design matches script section tags against `tags.name` (folder name). Each product auto-creates 17 fixed tag folders (Hook, Lead, Solution Mechanism, etc.), and every clip belongs to one folder whose name IS the match key.

After analyzing real VSL scripts, the fixed folder-based tagging is too coarse:
- Real scripts use granular compound tags: `FS-clipper-freakout`, `FS-dremel-loadnshake`, `UMP-compressthenail`, `Product-in-use-Labrador`, `Before-after-muzzle`, etc.
- Dozens of distinct tags per product are common; a fixed 17-tag folder set cannot cover them.
- Each tag needs multiple interchangeable variants for swapping/cutting/editing (e.g., `fs-dremel-loadnshake-01`, `-02`, `-03`, `-04`).

## Goals

1. Match script section tags against B-roll names, not folder names.
2. Each B-roll has a conventional name `{base-name}-{NN}` where `NN` is a zero-padded integer for variants.
3. Auto-match pools all variants sharing the same base name and picks randomly (as today).
4. Folders remain as free-form, user-created UI organization, independent of matching.
5. Remove the 17-default-tag concept; a new product starts with zero folders.

## Non-Goals

- Multi-variant formats beyond numeric suffix (no `-Labrador`, no semantic variants).
- Migration of existing user data (destructive reset is acceptable — only 2 test clips exist).
- Changes to script format, FFmpeg pipeline, or render logic.
- Changes to Scenario A / B auto-match timing math.

## Key Decisions

| # | Decision | Chosen |
|---|----------|--------|
| Q1 | Role of folders | **B** — Pure UI organization, ignored by matching |
| Q2 | Base name derivation | **A** — Auto-strip `-\d+$` regex (numeric suffix only) |
| Q3 | B-roll name source | **C** — From filename on bulk upload, inline rename available |
| Q4 | Folder model | **B** — Free-form user-created folders, each clip has one folder |
| Approach | Schema strategy | **A** — Minimal: rename `tags` → `folders`, add `brollName` column |
| Migration | Existing DB data | **Reset** — Destructive `pnpm db:reset` + clear IndexedDB |
| Default folders | New product folders | **None** — Empty product, user creates folders on demand |
| Swap UI default | Swap filter | **By baseName** with "show all clips" toggle |

## Naming Convention

**Pattern:** `^[a-z0-9-]+-\d+$`

- Lowercase only.
- Dashes separate segments.
- Ends with `-` followed by one or more digits (zero-padded by convention, e.g., `-01`, `-02`, ..., `-99`).
- `-NN` suffix is the variant number.
- Everything before the trailing `-NN` is the base name.

**Examples:**

| B-roll name | Base name | Variant |
|-------------|-----------|---------|
| `fs-dremel-loadnshake-01` | `fs-dremel-loadnshake` | `01` |
| `fs-dremel-loadnshake-02` | `fs-dremel-loadnshake` | `02` |
| `product-in-use-3d-01` | `product-in-use-3d` | `01` |
| `product-in-use-labrador-01` | `product-in-use-labrador` | `01` |
| `hook-01` | `hook` | `01` |
| `testimonial-01` | `testimonial` | `01` |

**Script tag matching:** Script tags may be mixed case (`FS-clipper-freakout`, `Before-after`). Lookup lowercases the script tag and compares to lowercased base names. B-roll names themselves are always stored lowercase.

## Architecture

### Schema changes

**Rename `tags` → `folders`:**

```ts
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("folders_product_name_unique").on(t.productId, t.name),
    index("folders_product_id_idx").on(t.productId),
  ],
);
```

**Modify `clips`:**

```ts
export const clips = pgTable(
  "clips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    brollName: varchar("broll_name", { length: 255 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    indexeddbKey: varchar("indexeddb_key", { length: 255 }).notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("clips_product_broll_name_unique").on(t.productId, t.brollName),
    index("clips_product_id_idx").on(t.productId),
    index("clips_folder_id_idx").on(t.folderId),
  ],
);
```

Changes from current spec:
- `tag_id` → `folder_id`.
- Added `productId` (denormalized) so `(productId, brollName)` can be globally unique within a product and queries avoid JOINs.
- Added `brollName` (varchar 255, NOT NULL), validated at app layer against `^[a-z0-9-]+-\d+$`.
- Kept `filename` for display (original upload filename). The `brollName` is the matching key.

### Helper module

Create `src/lib/broll.ts`:

```ts
export const BROLL_NAME_PATTERN = /^[a-z0-9-]+-\d+$/;

export function deriveBaseName(brollName: string): string {
  return brollName.replace(/-\d+$/, "");
}

export function isValidBrollName(name: string): boolean {
  return BROLL_NAME_PATTERN.test(name);
}

export function filenameToBrollName(filename: string): string {
  return filename.replace(/\.mp4$/i, "").toLowerCase();
}
```

### Auto-match engine

Input shape changes:

```ts
interface ClipMetadata {
  id: string;
  brollName: string;
  baseName: string; // derived at load time
  durationMs: number;
  // ... other fields unchanged
}

interface MatchInput {
  sections: ParsedSection[];
  clipsByBaseName: Map<string, ClipMetadata[]>; // lowercase baseName → variants
}
```

Build the map once before calling the match engine:

```ts
function buildClipsByBaseName(clips: ClipMetadata[]): Map<string, ClipMetadata[]> {
  const map = new Map<string, ClipMetadata[]>();
  for (const clip of clips) {
    const key = deriveBaseName(clip.brollName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(clip);
  }
  return map;
}
```

Lookup inside the engine:

```ts
const key = section.tag.toLowerCase();
const candidates = clipsByBaseName.get(key) ?? [];
```

Scenario A / B logic, re-roll, chain, repetition avoidance, and placeholder-on-empty are unchanged — they operate on the candidate list.

### Script parser validation

Input signature changes:

```ts
interface ParseInput {
  scriptText: string;
  availableBaseNames: Set<string>; // lowercase base names from product's clips
}
```

For each parsed section:

```ts
const key = tag.toLowerCase();
if (!availableBaseNames.has(key)) {
  warnings.push({
    line,
    message: `Tag "${tag}" has no matching B-roll (base name: ${key}). Section will render black frames.`,
  });
}
```

Script format and error rules are otherwise unchanged from the current parser spec.

### Upload pipeline

**Bulk drag-and-drop flow:**

1. User drops N `.mp4` files onto a folder (or uses file picker).
2. Client derives `brollName` per file: `filenameToBrollName(filename)`.
3. Validate each file:
   - Pattern check against `BROLL_NAME_PATTERN`.
   - Duplicate check against existing clips in the product (API precheck).
4. Render a staging table with one row per file:
   - Valid + unique → "ready".
   - Pattern fail → "invalid name" with inline [Rename] input.
   - Duplicate → "duplicate" with [Rename] or [Skip].
5. User fixes invalid rows inline, then clicks "Upload N valid files".
6. For each valid file, run the existing transcode → thumbnail → IndexedDB → metadata POST pipeline, with `brollName` + `folderId` + `productId` in the metadata body.

Validation order inside POST `/api/products/:id/folders/:folderId/clips`:
1. Auth + ownership check.
2. Pattern validation on `brollName`.
3. Uniqueness check on `(productId, brollName)`.
4. Insert row.

### UI

**Workspace layout:**

- **Left sidebar — Folders:** Free-form folder list (user-created). Includes a virtual "All clips" at top that spans the whole product.
- **Main area — Clip grid:** Shows clips in the selected folder, auto-grouped by base name. Each group header shows `baseName (N)`; variants listed in order `-01`, `-02`, …

**Clip actions:**
- **Rename:** inline edit on `brollName`, validated against pattern and uniqueness.
- **Move to folder:** dropdown of folders in the current product.
- **Delete:** confirm dialog; cascades to IndexedDB + thumbnail.
- **Preview:** click thumbnail → modal with `<video>` player.

**Timeline Preview — missing-matches panel:**

Before "Render Video" becomes enabled (or as a collapsible panel above it), show a summary of script tags with no matching base name:

```
⚠ 3 tags without B-roll matches:
  - fs-dremel-loadnshake    (appears 5 times, 12.3s total)
  - ump-nailtobrain         (appears 2 times, 4.1s total)
  - before-after            (appears 8 times, 20.5s total)

These sections will render as black frames.
```

**Swap action (P1):** Opens a picker filtered by the section's base name by default; a "Show all clips" toggle expands to every clip in the product.

### API routes

Rename and augment:

| Method | Path | Notes |
|--------|------|-------|
| POST   | `/api/products/:id/folders` | Create folder (was `/tags`). |
| GET    | `/api/products/:id/folders` | List folders with clip counts. |
| PUT    | `/api/products/:id/folders/:folderId` | Rename folder. |
| DELETE | `/api/products/:id/folders/:folderId` | Delete folder (cascade clips). |
| GET    | `/api/products/:id/folders/:folderId/clips` | List clips in folder. |
| POST   | `/api/products/:id/folders/:folderId/clips` | Create clip; body includes `brollName`. Validates pattern + uniqueness. |
| GET    | `/api/products/:id/clips` | New — list all clips in product (for "All clips" view, auto-match input, and base-name index). |
| PATCH  | `/api/products/:id/clips/:clipId` | New — rename (`brollName`) or move (`folderId`). Validates pattern + uniqueness on rename. |
| DELETE | `/api/products/:id/clips/:clipId` | Moved — single-clip operations are product-scoped (not folder-scoped) since they don't depend on current folder. |

**`POST /api/products`** no longer auto-creates 17 default tags. Product starts empty.

## Data Flow

**Build Video auto-match (happy path):**

1. User pastes script → parser validates with `availableBaseNames` set.
2. Client calls `GET /api/products/:id/clips` → receives all clips for the product.
3. Client derives `baseName` per clip and builds `clipsByBaseName` map.
4. Auto-match engine runs with `sections` + `clipsByBaseName`.
5. For each section, look up `section.tag.toLowerCase()`.
6. If candidates found: apply Scenario A/B.
7. If no candidates: return placeholder (black frames) + warning.
8. Render flow consumes matched clips from IndexedDB as today.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Upload filename doesn't match `^[a-z0-9-]+-\d+$` (after lowercasing + stripping `.mp4`) | Row marked "invalid name" in staging; user renames inline. Blocks that row only. |
| Duplicate `brollName` within product | Row marked "duplicate"; user renames or skips. |
| Script tag has no matching base name | Parser warning; auto-match emits placeholder; Timeline Preview aggregates into missing-matches panel. |
| Product has zero clips | Auto-match returns all placeholders; Timeline Preview shows prominent "No B-rolls uploaded" state. |
| Folder deletion with clips inside | Confirmation dialog lists clips to be deleted; cascades on confirm. |
| Script contains tag but clip is deleted mid-session | Re-running auto-match (re-roll or re-parse) picks up the new state; existing assignments that referenced the deleted clip fall back to placeholders. |

## Testing Strategy

**Pure logic (Vitest / Jest-style unit tests):**

- `deriveBaseName` — examples with and without `-NN`, edge cases (`hook-1`, `hook-999`, `hook` without suffix).
- `isValidBrollName` — valid, uppercase (invalid), no suffix (invalid), non-integer suffix (invalid), special chars (invalid).
- `filenameToBrollName` — `.mp4`, `.MP4`, trailing paths.
- `buildClipsByBaseName` — groups variants correctly, preserves order.
- Auto-match engine — all existing scenarios retested with baseName-keyed map.
- Script parser — warnings for unknown base names, case-insensitive matching.

**Component tests (where applicable):**
- Upload staging table: valid / invalid / duplicate rows render correctly; inline rename clears errors.
- Timeline Preview missing-matches panel aggregation.

**Manual verification:**
- End-to-end: upload set of real VSL clips → paste one of the provided sample scripts → verify auto-match selects correct base-name groups → render.

## Migration Plan

### Before coding

1. Update `specs/broll-auto-assembly/requirements.md`:
   - Remove "17 default tags auto-created".
   - Replace "tag folders" wording with "folders" (free-form) + "B-roll names" (match keys).
   - Add B-roll naming convention section.
   - Update parser rules: warn on missing base names.
2. Update `specs/broll-auto-assembly/implementation-plan.md`:
   - Phase 1: new schema (folders, clips with brollName).
   - Phase 2: remove default tag seeding.
   - Phase 3: folder sidebar + bulk upload staging + group-by-baseName grid + rename/move.
   - Phase 4: parser validates against `availableBaseNames`.
   - Phase 5: auto-match keyed by baseName.
   - Re-open `[x]` checkboxes that reference removed/changed behavior.
3. Add to `specs/broll-auto-assembly/action-required.md`:
   - Run `pnpm db:reset` to drop old `tags`/`clips` tables and push new schema.
   - Clear IndexedDB in Chrome DevTools (Application → IndexedDB → `broll-auto-assembly` → Delete database) to remove orphaned test clip binaries.

### Destructive reset (acceptable)

Current Supabase state: `products`, `tags`, `clips` exist; `clips` has 2 test rows (`Hook-01.mp4`, `Vibration-01.mp4`). Test-only data — safe to drop.

```bash
pnpm db:reset   # drizzle-kit drop && drizzle-kit push
```

User manually deletes the IndexedDB database in-browser after reset.

### Code changes (after spec update)

1. Update `src/lib/schema.ts` with new tables.
2. `pnpm db:generate && pnpm db:push`.
3. Add `src/lib/broll.ts`.
4. Refactor auto-match engine input shape.
5. Refactor script parser validation input.
6. Rename/add API routes.
7. Update workspace UI: folder sidebar, bulk upload staging, base-name grouping in grid, missing-matches panel.

## Open Questions / Future Work

- **Global clip library across products?** Out of scope here. Current design keeps clips scoped to a single product.
- **Variant padding policy (e.g., `-1` vs `-01`)?** Current pattern accepts any `\d+`; convention is zero-padded but not enforced. Revisit if inconsistency causes sorting issues.
- **Rename-as-cascade on folders:** No cascade needed — folders don't participate in matching.
- **Richer folder metadata (color, icon)?** P2 if ever.
