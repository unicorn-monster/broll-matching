# B-Roll Auto Assembly Tool — Design Spec

## Overview

A local web app that automates VSL (Video Sales Letter) video assembly. The user pastes a timestamped, tagged script and the tool auto-matches B-roll clips from a local library organized by tag folders, then renders a complete MP4 video — all client-side via FFmpeg.wasm.

**Scope:** P0 + P1 requirements from the PRD.

---

## Decisions Log

| # | Topic | Decision |
|---|-------|---------|
| 1 | Scope | P0 + P1 |
| 2 | Pre-transcode | Yes — 1080x1350 H.264 on upload via FFmpeg.wasm |
| 3 | Max video length | No limit |
| 4 | Existing starter pages | Keep (chat, dashboard, auth) |
| 5 | UI direction | Clean functional UI, no Figma |
| 6 | Deployment | Local dev only |
| 7 | Testing | Full coverage on: script parser, auto-match engine, timing logic |
| 8 | Database | Supabase as hosted PostgreSQL only. Drizzle ORM + better-auth unchanged. |
| 9 | Storage split | Metadata in Supabase PostgreSQL. Binary video in IndexedDB. |
| 10 | Upload sync | Validate-first → Transcode → IndexedDB → Postgres metadata |
| 11 | Thumbnails | Extract frame on upload via FFmpeg.wasm, store in IndexedDB |
| 12 | Build Video flow | All 4 steps visible on one scrollable page |
| 13 | Aspect ratio | Hardcoded 4:5 (1080x1350) |
| 14 | First-time UX | Simple empty states with action buttons |
| 15 | Library layout | Sidebar + Grid (tags in sidebar, clips in main grid) |
| 16 | B-roll audio | Mute all — only uploaded MP3 voiceover plays |

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui |
| Database | Supabase (hosted PostgreSQL) + Drizzle ORM |
| File Storage | Browser IndexedDB via `idb` |
| Video Processing | FFmpeg.wasm v0.12+ |
| Auth | better-auth |
| State Management | React 19 built-in (useState/useReducer + Context) |

### System Diagram

```
[Browser Client]
├─ Next.js React UI
│  ├─ Dashboard / Product Selector
│  ├─ B-Roll Library Manager (sidebar + grid)
│  ├─ Build Video Page (4-step scrollable flow)
│  └─ Timeline Preview (vertical section list)
├─ Auto-Match Engine (pure TypeScript module)
│  └─ Timing logic (speed-up, chaining, edge cases)
├─ FFmpeg.wasm (Web Worker)
│  ├─ Pre-transcode on upload (→ 1080x1350 H.264)
│  ├─ Thumbnail extraction (→ JPEG frame)
│  └─ Final video rendering (concat + audio overlay)
└─ IndexedDB (idb library)
   ├─ Clip binary storage (keyed by clip UUID)
   └─ Thumbnail storage (keyed by clip UUID)

[Server / DB]
├─ Supabase PostgreSQL via Drizzle
│  ├─ products
│  ├─ tags
│  └─ clips (metadata only)
└─ better-auth (user sessions)
```

### Required Headers (next.config.ts)

FFmpeg.wasm requires SharedArrayBuffer, which requires:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Browser Support

Chrome 110+ and Edge 110+ only. Safari/Firefox are non-goals.

---

## Data Model

### PostgreSQL (Drizzle ORM)

**products**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | Auto-generated |
| name | varchar(255) | Product name |
| user_id | text (FK → user.id) | Owner |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-updated |

**tags**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | Auto-generated |
| product_id | uuid (FK → products.id) | Parent product |
| name | varchar(100) | Tag name |
| sort_order | integer | Display ordering |
| created_at | timestamp | Auto-set |

**clips**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | Auto-generated |
| tag_id | uuid (FK → tags.id) | Parent tag |
| filename | varchar(255) | Original filename |
| duration_ms | integer | Clip duration |
| width | integer | Source width (px) |
| height | integer | Source height (px) |
| indexeddb_key | varchar(255) | Key for binary retrieval |
| file_size_bytes | bigint | Storage tracking |
| created_at | timestamp | Auto-set |

Cascade deletes: product → tags → clips metadata. Client-side cleanup deletes IndexedDB entries.

### IndexedDB

```
Database: "broll-auto-assembly"

Object Store: "clips"
  Key: clip UUID
  Value: { id, productId, data: ArrayBuffer, mimeType: "video/mp4" }

Object Store: "thumbnails"
  Key: clip UUID
  Value: { id, data: ArrayBuffer, mimeType: "image/jpeg" }
```

### Default Tag Set

17 tags auto-created with each new product: Hook, Lead, Solution Mechanism, Problem Mechanism, Metaphor, Agitate Problem, Discredit Solution 01, Discredit Solution 02, Product Intro, Supporting Benefits, Social Proof, Authority, Guarantee, Risk Free, Offer, Urgency, CTA.

Users can add, rename (P1), or delete tags at any time.

---

## Upload Flow

The upload pipeline runs when a user adds a clip to a tag folder:

1. **Validate** — API call to confirm tag exists, product exists, user has access. Fail fast before expensive work.
2. **Transcode** — FFmpeg.wasm converts the clip to 1080x1350 H.264. Progress shown to user.
3. **Extract thumbnail** — FFmpeg.wasm extracts a single JPEG frame at 1 second.
4. **Store binary** — Write transcoded MP4 + thumbnail to IndexedDB.
5. **Store metadata** — Write clip record to Supabase PostgreSQL.
6. **On metadata failure** — Delete from IndexedDB, show error, user retries.

This order guarantees no orphan metadata (metadata pointing to a missing file).

---

## UI Screens

### Screen 1: Dashboard (`/dashboard`)

- Grid of product cards: name, clip count, last updated
- "+ New Product" button → name input dialog
- Click card → `/dashboard/[productId]`
- Delete product (P1): trash icon, confirmation dialog, cascade cleanup

### Screen 2: Product Workspace (`/dashboard/[productId]`)

Two tabs:

**Tab A — B-Roll Library (Sidebar + Grid layout)**

- Left sidebar: list of tag folders with clip counts. Active tag highlighted. "+ Add Tag" button at bottom.
- Right panel: clip grid for selected tag. Shows thumbnails with duration overlays (P1). "Upload Clips" button. Delete individual clips.
- Tag actions: rename (P1), delete with confirmation.
- Header shows: tag name, clip count, total storage (P1).
- Empty state: "No clips yet — upload your first clip" with upload button.

**Tab B — Build Video (Single scrollable page)**

All 4 steps visible. Inactive steps dimmed at 50% with "WAITING FOR..." labels. Steps 1 and 2 can be completed in any order. Step 3 requires Step 2. Step 4 requires both Steps 1 and 3.

**Step 1 — Upload Audio**
- Drag-and-drop zone or file picker for MP3.
- After upload: show filename and duration.
- Status: READY (always active).

**Step 2 — Paste Script**
- Large textarea with monospace font.
- Placeholder shows format example: `00:00 - 00:04 || Hook || Script text here`
- "Parse" button validates and extracts sections.
- Validation errors shown inline (red) for invalid lines.
- Warning shown (yellow) for unrecognized tags.
- Status: READY (always active, independent of Step 1).

**Step 3 — Review Timeline**
- Activates after script is parsed.
- Vertical list of sections, each row showing:
  - Tag name (color-coded, P1) + time range + duration
  - Clip thumbnail(s) with speed badge if sped up (P1)
  - "Re-roll" button (re-randomize clip selection)
  - "Swap" button (P1, pick specific clip from tag library)
- Empty tag warning: yellow border, "No clips — will render as black"
- Status: shows section count (e.g., "12 SECTIONS").

**Step 4 — Render & Export**
- Activates after timeline is reviewed AND audio is uploaded.
- "Render Video" button.
- During render: progress bar with section count ("Section 7 of 12") and estimated time remaining.
- On completion: auto-download MP4.

---

## Script Parser

Parses the format: `HH:MM:SS - HH:MM:SS || Tag Name || Script text content`

**Input:** Multi-line string from textarea.
**Output:** Array of `{ startTime: number, endTime: number, tag: string, scriptText: string, durationMs: number }`

**Rules:**
- Each non-empty line must match the format. Invalid lines produce an error with line number.
- Timestamps parsed as seconds. Support both HH:MM:SS and MM:SS (P1).
- Duration = endTime - startTime (in ms).
- Tags are trimmed and matched case-insensitively against the product's tag list.
- Unrecognized tags produce a warning (not an error — parsing still succeeds).
- Zero-duration sections are flagged with a warning.

---

## Auto-Match Engine

Pure TypeScript module. No DOM dependencies. Fully unit-testable.

**Input:** Parsed script sections + clip metadata (from Postgres, keyed by tag).
**Output:** Array of matched assignments: `{ sectionIndex, clips: [{ clipId, speedFactor, trimDuration? }] }`

### Algorithm

For each section:

1. Find all clips in the matching tag folder.
2. If tag folder is empty → assign placeholder (black frames). Add warning.
3. If section duration is 0 → skip.

**Scenario A — Section ≤ Single Clip:**
- Pick a random clip.
- `speedFactor = clipDuration / sectionDuration`
- If `speedFactor ≤ 2.0`: use clip at that speed.
- If `speedFactor > 2.0`: trim clip to `sectionDuration × 2`, play at 2x.

**Scenario B — Section > Single Clip:**
1. `remainingTime = sectionDuration`
2. Pick a random clip (avoid repeats if possible, P1).
3. If `clipDuration ≤ remainingTime`: add at 1x. `remainingTime -= clipDuration`.
4. If `clipDuration > remainingTime`: apply Scenario A logic for `remainingTime`.
5. Repeat until `remainingTime = 0`.

**Edge cases:**
- Single clip in folder: reuse as needed.
- Re-roll: re-run random selection for one section. Different seed.
- Swap (P1): user picks a specific clip, engine adjusts timing.

---

## Video Renderer

Uses FFmpeg.wasm in a Web Worker.

**Input:** Matched clip assignments (with speed factors) + audio MP3 + clip binaries from IndexedDB.
**Output:** Single MP4 file, 1080x1350, H.264.

**Process:**
1. Load FFmpeg.wasm in Web Worker.
2. For each section, sequentially:
   a. Load clip binary from IndexedDB into FFmpeg's virtual filesystem.
   b. Apply speed adjustment via `setpts` filter (e.g., `setpts=0.5*PTS` for 2x).
   c. Apply trim if needed.
   d. Write processed segment to temp file.
   e. Clean up input from virtual filesystem (memory management).
3. Concatenate all segments via `concat` demuxer.
4. Overlay the MP3 audio track (B-roll audio is muted).
5. Export final MP4.
6. Trigger browser download.

**Progress reporting:** Web Worker posts progress messages back to main thread. UI shows current section and estimated time remaining.

**Empty tag sections:** Render black frames at 1080x1350 for the section duration using `color` filter.

---

## API Routes

All routes under `src/app/api/`:

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/products` | GET, POST | List/create products |
| `/api/products/[id]` | GET, PUT, DELETE | Get/update/delete product |
| `/api/products/[id]/tags` | GET, POST | List/create tags |
| `/api/products/[id]/tags/[tagId]` | PUT, DELETE | Update/delete tag |
| `/api/products/[id]/tags/[tagId]/clips` | GET, POST | List/create clip metadata |
| `/api/products/[id]/tags/[tagId]/clips/[clipId]` | DELETE | Delete clip metadata |

All routes protected by better-auth session. User can only access their own products.

---

## IndexedDB Wrapper (`src/lib/clip-storage.ts`)

Thin wrapper over `idb` library:

- `saveClip(id, productId, data: ArrayBuffer)` — store transcoded MP4
- `saveThumbnail(clipId, data: ArrayBuffer)` — store JPEG thumbnail
- `getClip(id)` — retrieve MP4 binary
- `getThumbnail(clipId)` — retrieve thumbnail
- `deleteClip(id)` — remove MP4 + thumbnail
- `deleteProductClips(productId)` — bulk cleanup for product deletion

---

## Implementation Phases (Feature-Slice Vertical)

| Phase | What | Key Files |
|-------|------|-----------|
| 1 | Data layer + infrastructure | Schema, IndexedDB wrapper, COOP/COEP headers, Supabase config |
| 2 | Product management | Dashboard UI, product CRUD API, new product dialog |
| 3 | B-Roll library | Tag sidebar, clip grid, upload with FFmpeg transcode + thumbnail, IndexedDB storage |
| 4 | Script parser | Pure logic module + full test suite |
| 5 | Auto-match engine | Pure logic module + full test suite |
| 6 | Timeline preview | Timeline UI, wire up auto-match, re-roll, swap (P1) |
| 7 | Video renderer | FFmpeg.wasm Web Worker, concat, audio overlay, progress, download |

Each phase is independently testable. Phases 4 and 5 are pure logic with no UI — ideal for TDD.

---

## Testing Strategy

### Unit Tests (Vitest)

**Script Parser:**
- Valid multi-line parsing
- Invalid format rejection with line numbers
- MM:SS shorthand (P1)
- Duration calculation
- Unrecognized tag flagging
- Edge cases: empty input, single line, overlapping timestamps, zero-duration

**Auto-Match Engine:**
- Single clip fits (no speed change)
- Speed-up ≤ 2x
- Trim + 2x for speed_factor > 2.0
- Multi-clip chaining
- Chain with speed-up on last clip
- No-repeat within section (P1)
- Re-roll produces different result
- Empty tag → placeholder + warning
- Single clip → reuse
- Zero-duration → skip

**Timing Logic:**
- Speed factor calculation precision
- 2x ceiling enforcement
- Trim behavior
- Remaining time tracking
- Float precision edge cases

### Not Unit Tested (Future E2E)
- FFmpeg.wasm rendering pipeline
- IndexedDB read/write cycle
- Full upload → transcode → store → retrieve flow

---

## Non-Goals (v1)

- Text overlays / captions / subtitles
- Transitions between sections (hard cuts only)
- AI-powered auto-tagging
- Team collaboration
- Audio waveform editor
- Stock footage API integrations
- Drag-and-drop section reordering (P2)
- SRT/VTT import
- Rendered video caching
- Safari / Firefox support
- Multiple aspect ratio options
