# Implementation Plan: B-Roll Auto Assembly Tool

## Overview

Build a local web app that automates VSL video assembly. User pastes a timestamped tagged script, the tool auto-matches B-roll clips from a local library, and renders a complete MP4 — all client-side via FFmpeg.wasm. Built on the existing Next.js 16 starter kit with Supabase PostgreSQL for metadata and IndexedDB for clip binaries.

---

## Phase 1: Data Layer & Infrastructure

Set up the database schema, IndexedDB wrapper, FFmpeg.wasm configuration, and required browser headers.

### Tasks

- [x] Install dependencies: `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `idb` [complex]
  - [x] Add `@ffmpeg/ffmpeg` and `@ffmpeg/util` (v0.12+) for client-side video processing
  - [x] Add `idb` library for Promise-based IndexedDB access
  - [x] Verify packages resolve correctly with `pnpm install`
- [ ] Create Drizzle ORM schema for `products`, `folders`, and `clips` tables (see updated schema below)
- [ ] Create B-roll helper module at `src/lib/broll.ts`
- [ ] Run `pnpm db:reset` to drop old schema and push new schema
- [x] Create IndexedDB wrapper module at `src/lib/clip-storage.ts`
- [x] Configure COOP/COEP headers in `next.config.ts` for SharedArrayBuffer support
- [x] Create FFmpeg.wasm singleton loader utility at `src/lib/ffmpeg.ts`

### Technical Details

**Dependencies to install:**
```bash
pnpm add @ffmpeg/ffmpeg @ffmpeg/util idb
```

**Drizzle schema (`src/lib/schema.ts` — extend existing file):**

```typescript
// Products table
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Folders table — free-form user-created, for UI organization only (NOT used for matching)
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("folders_product_name_unique").on(t.productId, t.name),
    index("folders_product_id_idx").on(t.productId),
  ],
);

// Clips table (metadata only — binary in IndexedDB)
export const clips = pgTable(
  "clips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").notNull().references(() => folders.id, { onDelete: "cascade" }),
    brollName: varchar("broll_name", { length: 255 }).notNull(), // pattern: ^[a-z0-9-]+-\d+$, unique per product
    filename: varchar("filename", { length: 255 }).notNull(),    // original upload filename, display only
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

**B-roll helper (`src/lib/broll.ts`):**
```typescript
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

**IndexedDB wrapper (`src/lib/clip-storage.ts`):**
```typescript
// Database: "broll-auto-assembly"
// Object Store: "clips" — Key: clip UUID, Value: { id, productId, data: ArrayBuffer, mimeType }
// Object Store: "thumbnails" — Key: clip UUID, Value: { id, data: ArrayBuffer, mimeType }
//
// Exports:
// - saveClip(id, productId, data: ArrayBuffer)
// - saveThumbnail(clipId, data: ArrayBuffer)
// - getClip(id) → ArrayBuffer
// - getThumbnail(clipId) → ArrayBuffer
// - deleteClip(id) — removes MP4 + thumbnail
// - deleteProductClips(productId) — bulk cleanup
```

**COOP/COEP headers (`next.config.ts`):**
```typescript
headers: async () => [
  {
    source: "/(.*)",
    headers: [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ],
  },
],
```

**FFmpeg loader (`src/lib/ffmpeg.ts`):**
- Singleton pattern — load once, reuse across operations
- Runs in Web Worker to prevent UI freezing
- Exposes `loadFFmpeg()`, `isLoaded()` helpers

---

## Phase 2: Product Management

Build the dashboard UI and product CRUD API so users can create and manage products.

### Tasks

- [x] Create API routes for product CRUD [complex]
  - [x] `GET /api/products` — list products for authenticated user
  - [ ] `POST /api/products` — create product (no default folders; product starts empty)
  - [x] `GET /api/products/[id]` — get single product
  - [x] `PUT /api/products/[id]` — update product name
  - [x] `DELETE /api/products/[id]` — delete product (cascade folders, clips metadata, IndexedDB cleanup)
- [x] Build Dashboard page at `src/app/dashboard/page.tsx` — product card grid with clip count and last updated
- [x] Build "New Product" dialog component with name input
- [x] Build product card component with delete confirmation (P1)
- [x] Wire dashboard to API routes with loading and empty states

### Technical Details

**API routes location:** `src/app/api/products/` and `src/app/api/products/[id]/`

**All routes protected by better-auth session.** Use existing auth helpers from `src/lib/auth.ts` and `src/lib/session.ts`.

**No default folders.** `POST /api/products` creates the product record only; no folders are auto-seeded. Empty state in workspace prompts user to create their first folder.

**Dashboard UI:**
- Grid of product cards: name, clip count, last updated
- "+ New Product" button opens dialog
- Click card navigates to `/dashboard/[productId]`
- Empty state: "No products yet" with create button

**Product deletion** must cascade: delete Postgres metadata (products → folders → clips via cascade) AND call `deleteProductClips(productId)` on IndexedDB.

---

## Phase 3: B-Roll Library Manager

Build the folder sidebar + clip grid UI, bulk upload pipeline with staging table, FFmpeg.wasm transcoding, and IndexedDB storage.

### Tasks

- [ ] Create API routes for folders CRUD [complex]
  - [ ] `GET /api/products/[id]/folders` — list folders with clip counts
  - [ ] `POST /api/products/[id]/folders` — create folder
  - [ ] `PUT /api/products/[id]/folders/[folderId]` — rename folder (P1)
  - [ ] `DELETE /api/products/[id]/folders/[folderId]` — delete folder (cascade clips)
- [ ] Create API routes for clips CRUD [complex]
  - [ ] `GET /api/products/[id]/folders/[folderId]/clips` — list clip metadata in folder
  - [ ] `GET /api/products/[id]/clips` — list all clips in product (for "All clips" view + auto-match)
  - [ ] `POST /api/products/[id]/folders/[folderId]/clips` — create clip; body includes `brollName`; validates pattern + uniqueness
  - [ ] `PATCH /api/products/[id]/clips/[clipId]` — rename (`brollName`) or move to folder (`folderId`)
  - [ ] `DELETE /api/products/[id]/clips/[clipId]` — delete clip metadata
- [ ] Build Product Workspace page at `src/app/dashboard/[productId]/page.tsx` with tab navigation (B-Roll Library / Build Video)
- [ ] Build folder sidebar component — list folders with clip counts, virtual "All clips" entry at top, active highlight, "+ Add Folder" button, rename/delete actions
- [ ] Build clip grid component — thumbnails with duration overlays (P1), clips grouped by B-roll base name, delete/rename/move actions per clip
- [ ] Build clip upload pipeline (client-side) [complex]
  - [ ] Bulk drag-and-drop zone + file picker for MP4 files (multiple files at once)
  - [ ] Upload staging table: derive `brollName` from filename; validate pattern and check uniqueness (API precheck); show "ready" / "invalid name" / "duplicate" per row with inline rename input
  - [ ] Transcode to 1080x1350 H.264 via FFmpeg.wasm with progress indicator per file
  - [ ] Extract thumbnail JPEG frame at 1 second via FFmpeg.wasm
  - [ ] Store transcoded MP4 + thumbnail in IndexedDB
  - [ ] Store clip metadata in Supabase PostgreSQL (include `brollName`, `folderId`, `productId`)
  - [ ] On metadata write failure: delete from IndexedDB and show error
- [ ] Build folder header with clip count and total storage display (P1)
- [ ] Implement empty states — "No clips yet" with upload button; "No folders" with create prompt

### Technical Details

**Upload sync strategy (order matters):**
1. Client: derive `brollName = filenameToBrollName(filename)`, validate pattern
2. API precheck: `GET /api/products/:id/clips` → check for duplicate `brollName`
3. Transcode (FFmpeg.wasm → 1080x1350 H.264)
4. Extract thumbnail (FFmpeg.wasm → JPEG at 1s)
5. Store binary (IndexedDB — `saveClip()` + `saveThumbnail()`)
6. Store metadata (Postgres — `POST /api/.../clips` with `brollName`)
7. On step 6 failure → delete from IndexedDB, show error

**POST `/api/products/[id]/folders/[folderId]/clips` validation order:**
1. Auth + ownership check
2. Pattern check: `brollName` must match `^[a-z0-9-]+-\d+$`
3. Uniqueness check: `(productId, brollName)` must be unique
4. Insert row

**FFmpeg transcode command (conceptual):**
```
ffmpeg -i input.mp4 -vf "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset fast -an output.mp4
```

**FFmpeg thumbnail extraction:**
```
ffmpeg -i input.mp4 -ss 00:00:01 -frames:v 1 -f image2 thumbnail.jpg
```

**Layout:** Sidebar + Grid. Folders in left sidebar (collapsible on mobile). "All clips" virtual entry at sidebar top. Clips in main area grouped by base name — each group header shows `baseName (N variants)`, variants listed `-01`, `-02`, … Folder actions (rename, delete) via context menu or inline buttons.

**File paths:**
- `src/app/dashboard/[productId]/page.tsx` — workspace page
- `src/components/broll/folder-sidebar.tsx`
- `src/components/broll/clip-grid.tsx`
- `src/components/broll/clip-upload.tsx`

---

## Phase 4: Script Parser

Build the pure TypeScript script parser module that converts pasted text into structured timeline sections.

### Tasks

- [x] Create script parser module at `src/lib/script-parser.ts`
- [x] Implement line-by-line parsing of `HH:MM:SS - HH:MM:SS || Tag Name || Script text` format
- [x] Implement `MM:SS` shorthand support (P1)
- [x] Implement validation: reject invalid lines with error messages including line numbers
- [x] Implement duration calculation from timestamps (in milliseconds)
- [ ] Implement tag matching: case-insensitive match of section tag against product's available B-roll base names (`availableBaseNames: Set<string>`); warn on missing base names
- [x] Implement edge case handling: empty input, zero-duration sections, blank lines

### Technical Details

**Module:** `src/lib/script-parser.ts` — pure TypeScript, no DOM dependencies, fully unit-testable.

**Input:** Multi-line string from textarea + set of available B-roll base names (derived from all clips in the product).

**Output types:**
```typescript
interface ParsedSection {
  lineNumber: number;
  startTime: number;      // seconds
  endTime: number;        // seconds
  tag: string;            // original tag text (trimmed)
  scriptText: string;     // script content
  durationMs: number;     // (endTime - startTime) * 1000
}

interface ParseResult {
  sections: ParsedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}
```

**Parsing rules:**
- Each non-empty line must match: `HH:MM:SS - HH:MM:SS || Tag Name || Script text`
- `MM:SS` shorthand also accepted (P1): treated as `00:MM:SS`
- Blank lines are skipped silently
- Invalid lines produce an error with line number
- Tags with no matching B-roll base name in the product library produce a warning (not error — parsing still succeeds; those sections render as black frames)
- Zero-duration sections produce a warning
- Tags matched case-insensitively against available B-roll base names

---

## Phase 5: Auto-Match Engine

Build the pure TypeScript auto-match engine that assigns clips to timeline sections with speed/trim calculations.

### Tasks

- [ ] Create auto-match engine module at `src/lib/auto-match.ts`
- [ ] Implement Scenario A: section <= single clip duration (speed up, max 2x, or trim + 2x)
- [ ] Implement Scenario B: section > single clip duration (chain multiple clips, speed-adjust last)
- [ ] Implement clip repetition avoidance within a section (P1)
- [ ] Implement re-roll functionality (re-randomize clip selection for one section)
- [ ] Implement manual swap (P1): picker defaults to same base name variants; toggle shows all product clips
- [ ] Handle edge cases: no matching base name (black placeholder), single clip (reuse), zero-duration (skip)

### Technical Details

**Module:** `src/lib/auto-match.ts` — pure TypeScript, no DOM dependencies, fully unit-testable.

**Input:**
```typescript
interface ClipMetadata {
  id: string;
  brollName: string;   // e.g., "fs-dremel-loadnshake-01"
  baseName: string;    // derived: "fs-dremel-loadnshake"
  durationMs: number;
  // ... other fields
}

interface MatchInput {
  sections: ParsedSection[];
  clipsByBaseName: Map<string, ClipMetadata[]>;  // lowercase baseName → variant clips
}

// Build map before calling engine:
function buildClipsByBaseName(clips: ClipMetadata[]): Map<string, ClipMetadata[]> {
  const map = new Map<string, ClipMetadata[]>();
  for (const clip of clips) {
    const key = deriveBaseName(clip.brollName); // from src/lib/broll.ts
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(clip);
  }
  return map;
}
```

**Output:**
```typescript
interface MatchedSection {
  sectionIndex: number;
  clips: MatchedClip[];
  warnings: string[];
}

interface MatchedClip {
  clipId: string;
  speedFactor: number;      // 1.0 = normal, 2.0 = max
  trimDurationMs?: number;  // if clip needs trimming before speed-up
  isPlaceholder: boolean;   // true = black frames (empty tag)
}
```

**Scenario A (section <= clip):**
- `speedFactor = clipDurationMs / sectionDurationMs`
- If `speedFactor <= 2.0`: use at that speed
- If `speedFactor > 2.0`: trim to `sectionDurationMs * 2`, play at 2x

**Scenario B (section > clip):**
1. `remainingMs = sectionDurationMs`
2. Pick random clip (avoid repeats if possible, P1)
3. If `clipDurationMs <= remainingMs`: add at 1x, `remainingMs -= clipDurationMs`
4. If `clipDurationMs > remainingMs`: apply Scenario A for `remainingMs`
5. Repeat until `remainingMs = 0`

**Lookup:**
```typescript
const key = section.tag.toLowerCase();
const candidates = clipsByBaseName.get(key) ?? [];
```

**Edge cases:**
- Single clip for a base name: reuse same clip as needed
- No clips matching base name: return placeholder (black frames) + warning
- Zero-duration section: skip entirely (empty clips array)

---

## Phase 6: Timeline Preview & Build Video UI

Build the Build Video wizard page — 4-step scrollable flow with audio upload, script paste, timeline review, and render trigger.

### Tasks

- [ ] Build Build Video page layout at `src/app/dashboard/[productId]/build/page.tsx` (or as Tab B in workspace) — 4-step scrollable page with activation logic
- [ ] Build Step 1: Audio Upload component — drag-and-drop/file picker for MP3, show filename + duration after upload
- [ ] Build Step 2: Script Paste component — monospace textarea with format placeholder, "Parse" button, inline validation errors/warnings
- [ ] Build Step 3: Timeline Preview component [complex]
  - [ ] Vertical section list showing tag name, time range, duration, clip thumbnails
  - [ ] Missing B-roll matches panel: aggregate all tags with no matching base name, show count + cumulative duration; display above render step
  - [ ] Color-coded sections by tag (P1)
  - [ ] Speed indicator badges for sped-up clips (P1)
  - [ ] "Re-roll" button per section — calls auto-match engine re-roll
  - [ ] "Swap" button per section (P1) — opens clip picker filtered to matching base name variants by default; "show all" toggle to see all product clips
- [ ] Build Step 4: Render trigger component — "Render Video" button, activates when Steps 1+3 complete
- [ ] Wire step activation logic: Steps 1 & 2 always active, Step 3 requires parsed script, Step 4 requires audio + timeline
- [ ] Wire auto-match engine: on script parse, run auto-match and populate timeline

### Technical Details

**Page layout:** Single scrollable page. All 4 steps visible. Inactive steps rendered at 50% opacity with "WAITING FOR [prerequisite]" label.

**Step activation rules:**
- Step 1 (Audio): Always active
- Step 2 (Script): Always active (independent of Step 1)
- Step 3 (Timeline): Requires Step 2 completed (script parsed)
- Step 4 (Render): Requires Step 1 (audio uploaded) AND Step 3 (timeline reviewed)

**Audio handling:** MP3 stored in memory (or IndexedDB for large files). Display filename and duration. Used during render.

**Script textarea placeholder:**
```
00:00 - 00:04 || Hook || Script text here
00:04 - 00:12 || Lead || More script text
```

**Timeline section row layout:**
```
[Tag Badge] 00:00 - 00:04 (4s)  [Thumbnail(s)] [1.5x badge] [Re-roll] [Swap]
```

**File paths:**
- `src/components/build/audio-upload.tsx`
- `src/components/build/script-paste.tsx`
- `src/components/build/timeline-preview.tsx`
- `src/components/build/render-trigger.tsx`
- `src/components/build/step-wrapper.tsx` — shared wrapper with activation/dimming logic

---

## Phase 7: Video Renderer

Build the FFmpeg.wasm rendering pipeline in a Web Worker — concatenate clips with speed adjustments, overlay audio, export final MP4.

### Tasks

- [ ] Create FFmpeg.wasm render worker at `src/workers/render-worker.ts` [complex]
  - [ ] Accept matched clip assignments, audio file, and clip binaries as input
  - [ ] Load clips from IndexedDB into FFmpeg's virtual filesystem sequentially
  - [ ] Apply `setpts` filter for speed adjustments per clip
  - [ ] Apply trim filter where needed
  - [ ] Concatenate all processed segments via concat demuxer
  - [ ] Overlay MP3 audio track (mute all B-roll audio with `-an`)
  - [ ] Export final MP4 (1080x1350, H.264)
  - [ ] Post progress messages to main thread (current section, estimated time)
  - [ ] Clean up virtual filesystem between clips for memory management
- [ ] Build render progress UI — progress bar with section count ("Section 7 of 12") and estimated time remaining
- [ ] Implement auto-download of rendered MP4 on completion
- [ ] Handle empty tag sections — render black frames at 1080x1350 using `color` filter for the section duration

### Technical Details

**Web Worker:** `src/workers/render-worker.ts` — runs FFmpeg.wasm off the main thread.

**Render pipeline (per section):**
1. Load clip binary from IndexedDB → write to FFmpeg virtual FS
2. Apply speed: `setpts=<factor>*PTS` (e.g., `setpts=0.5*PTS` for 2x speed)
3. Apply trim if needed: `-t <duration>`
4. Write processed segment to temp file
5. Clean up input from virtual FS (memory management — process one at a time)

**Concatenation:** Write a `concat.txt` file listing all segment paths, then:
```
ffmpeg -f concat -safe 0 -i concat.txt -i audio.mp3 -c:v copy -c:a aac -shortest output.mp4
```

**Black frames for empty tags:**
```
ffmpeg -f lavfi -i color=c=black:s=1080x1350:d=<duration> -c:v libx264 segment_N.mp4
```

**Progress reporting:** Worker posts `{ type: "progress", currentSection, totalSections, estimatedTimeRemaining }` messages. Main thread updates UI.

**Auto-download:** Create blob URL from output ArrayBuffer, trigger `<a download>` click.

**Memory management:** Critical for long videos. Process clips one at a time. Write each segment, delete input. Only keep segment temp files until concat, then clean all.
