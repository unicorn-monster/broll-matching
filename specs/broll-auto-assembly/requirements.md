# Requirements: B-Roll Auto Assembly Tool

## What

A local web app that automates VSL (Video Sales Letter) video assembly. The user pastes a timestamped, tagged script, the tool auto-matches B-roll clips from a local library by B-roll name, and renders a complete MP4 video — all client-side via FFmpeg.wasm.

## Why

Manually assembling VSL videos from tagged scripts and B-roll libraries is tedious and repetitive. This tool automates the clip selection, timing adjustment, and final rendering workflow so the user can go from script to finished video in minutes instead of hours.

## Scope

P0 + P1 requirements (full MVP plus quality-of-life features).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) — already in starter kit |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui — already in starter kit |
| Database | Supabase (hosted PostgreSQL) + Drizzle ORM — metadata only |
| File Storage | Browser IndexedDB via `idb` library — clip & thumbnail binaries |
| Video Processing | FFmpeg.wasm v0.12+ — client-side rendering in Web Worker |
| Auth | better-auth — already configured in starter kit |
| State Management | React 19 built-in (useState/useReducer + Context) |

## Acceptance Criteria

### Product Management
- [ ] User can create, view, and delete products from a dashboard
- [ ] Each product has its own independent B-roll library (tags + clips)
- [ ] Products are scoped to the authenticated user

### B-Roll Library Manager

**B-roll naming convention:** Every clip file must follow `{base-name}-{NN}.mp4` — all lowercase, dashes only, ends with a numeric variant suffix (e.g., `fs-dremel-loadnshake-01.mp4`, `hook-01.mp4`). The base name (everything before `-NN`) is the match key. Multiple variants of the same base name are used for random selection and swapping.

- [ ] User can create, rename (P1), and delete folders within a product (folders are for UI organization only — they do not affect matching)
- [ ] New product starts with zero folders (no default folders)
- [ ] User can upload MP4 clips into a folder via bulk drag-and-drop or file picker
- [ ] Upload staging: each dropped file is validated against the naming pattern and checked for duplicate B-roll name within the product; invalid/duplicate rows show inline rename input before upload begins
- [ ] Clips are pre-transcoded to 1080x1350 H.264 on upload via FFmpeg.wasm
- [ ] Thumbnail extracted on upload and displayed in clip grid
- [ ] Clip duration overlay shown on thumbnails (P1)
- [ ] Clip count and storage usage shown per folder (P1)
- [ ] Clips grouped by B-roll base name within the clip grid (e.g., all `fs-dremel-loadnshake-NN` variants appear together)
- [ ] User can rename a clip's B-roll name inline (validated against pattern and uniqueness) (P1)
- [ ] User can move a clip to a different folder (P1)
- [ ] User can delete individual clips
- [ ] Clips stored as binaries in IndexedDB; metadata in Supabase PostgreSQL
- [ ] Sync strategy: Validate -> Transcode -> IndexedDB -> Postgres metadata (fail fast)

### Script Parser
- [ ] Parses `HH:MM:SS - HH:MM:SS || Tag Name || Script text` format
- [ ] Supports `MM:SS` shorthand (P1)
- [ ] Rejects invalid lines with clear error messages including line numbers
- [ ] Calculates section duration from timestamps
- [ ] Flags tags with no matching B-roll base name in the product's library with warnings (parsing still succeeds; those sections render as black frames)
- [ ] Flags zero-duration sections with warnings

### Auto-Match Engine
- [ ] For each script section, looks up all clip variants whose B-roll base name matches the section tag (case-insensitive); randomly selects from those variants
- [ ] Scenario A (section <= clip): speeds up clip (max 2x) or trims + 2x
- [ ] Scenario B (section > clip): chains multiple clips, speed-adjusts last clip
- [ ] Avoids repeating same clip within a section when possible (P1)
- [ ] User can re-roll any section for different random selection
- [ ] User can manually swap a clip (P1): picker defaults to matching base name variants, with toggle to show all clips in product
- [ ] No matching base name found: renders black frames with warning

### Timeline Preview
- [ ] Displays sections with tag name, duration, and clip thumbnail(s)
- [ ] Missing B-roll matches summary panel: lists all tags with no matching B-roll base name, with total count and cumulative duration; shown before render step
- [ ] Color-coded sections by tag (P1)
- [ ] Speed indicator badges for sped-up clips (P1)
- [ ] Re-roll and swap controls per section

### Video Renderer
- [ ] Renders final MP4 (1080x1350, H.264) entirely client-side via FFmpeg.wasm
- [ ] Layers uploaded MP3 audio under assembled B-roll (B-roll audio muted)
- [ ] Applies speed adjustments and trims per auto-match assignments
- [ ] Hard cuts between all clips (no transitions)
- [ ] Progress bar with section count and estimated time remaining
- [ ] Auto-downloads rendered MP4 on completion

### Build Video Wizard
- [ ] All 4 steps visible on one scrollable page
- [ ] Inactive steps dimmed with "WAITING FOR..." labels
- [ ] Steps 1 (audio) and 2 (script) can be completed in any order
- [ ] Step 3 (timeline) requires Step 2
- [ ] Step 4 (render) requires Steps 1 and 3

### Infrastructure
- [ ] COOP/COEP headers configured for SharedArrayBuffer (FFmpeg.wasm requirement)
- [ ] Chrome 110+ / Edge 110+ only (Safari/Firefox are non-goals)
- [ ] No max video length limit

## Non-Goals (v1)

- Text overlays / captions / subtitles
- Transitions between sections (hard cuts only)
- AI-powered auto-tagging
- Team collaboration / multi-user
- Audio waveform editor
- Stock footage API integrations
- Drag-and-drop section reordering (P2)
- SRT/VTT import
- Rendered video caching
- Safari / Firefox support
- Multiple aspect ratio options

## Dependencies

- Existing starter kit: Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, better-auth, Drizzle ORM
- Supabase project (hosted PostgreSQL) — requires manual setup
- `@ffmpeg/ffmpeg` v0.12+ npm package
- `idb` npm package for IndexedDB
