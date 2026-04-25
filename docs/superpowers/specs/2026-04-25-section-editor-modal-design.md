# Section Editor Modal — Design Spec

**Date:** 2026-04-25
**Status:** Draft for review

## Goal

Let the user manually pick which b-roll variant(s) play for a given timeline section, instead of relying solely on random auto-match. Bundle three related improvements:

1. **Section Editor Modal** — click a "browse" icon next to a section's reroll button to open a modal that lists all variants for that tag, with thumbnails, duration, and a video preview.
2. **Chain editing** — for sections that need multiple clips chained, let the user pick each slot manually; system handles uniform speed-up.
3. **Visual flags** — yellow border on sections whose clips need >2× speed, lock icon on sections the user has manually edited.

## Why

Auto-match is good but random. Three pain points motivate the change:

- High-speed-up degrades quality (audio pitch, frame artifacts). User prefers chaining shorter clips over speed-ups beyond ~2×.
- The right b-roll is sometimes obvious to a human (matches the script semantics) but invisible to the random matcher.
- Currently no way to see WHICH variants exist for a tag without opening a separate file browser.

## Non-goals

- Not changing the auto-match algorithm itself (remains random pick from variants).
- Not adding cross-section reordering or trimming b-rolls inside a slot.
- Not persisting manual picks across page reloads in this iteration (timeline state is in-memory; persistence is a separate concern).
- Not adding hover-autoplay previews — click-to-load only.

---

## User flows

### Flow 1: Pick a single replacement variant

1. User reviews timeline, sees a section using a clip they don't want.
2. Clicks the **📋 Browse** icon on that section row.
3. Modal opens with grid of all variants for that tag (left pane) and an empty preview (right pane).
4. Clicks a thumbnail → video loads in right pane with playback controls + duration label.
5. Clicks **Use for slot 1** (or **Replace** when only one slot exists).
6. Modal closes. Section row updates with new clip. Section is marked `userLocked = true` and shows 🔒 icon.

### Flow 2: Build a chain manually

1. User opens modal for a section that auto-matched as a chain of 2 clips.
2. Modal shows current chain in a top strip: `[clip-A 2.5s] [clip-B 3.4s] [+]`. Footer shows `Total: 5.9s → 1.18× speed`.
3. User clicks slot 2 (currently `clip-B`) → variant grid highlights to indicate "picking for slot 2".
4. Clicks a different variant in grid + Preview, then **Use for slot 2** → slot 2 updated.
5. User clicks **+** to add a slot 3 → grid in "picking for new slot" mode → picks a clip → appended.
6. Footer recomputes live: `Total: 8.4s → 1.68× speed`.
7. User clicks ✕ on slot 1 to remove it. Footer recomputes.
8. Clicks **Save** → modal closes, section locked.

### Flow 3: Reset a manually-edited section

1. Section #5 has 🔒 icon (userLocked).
2. User clicks 🔄 Reroll on section #5.
3. Confirm dialog appears: *"This section was set manually. Reset to auto-pick?"* with **Reset** / **Cancel** buttons.
4. **Reset** → reroll runs, lock cleared, 🔒 icon removed.

### Flow 4: High-speed warning

1. User saves a chain whose total/section ratio gives speedFactor 2.4×.
2. Section row in timeline now has yellow border and ⚠ icon (tooltip: "Speed >2× — may distort audio/frames").
3. User can re-open modal and add more clips to reduce ratio under 2×; once under, yellow border disappears.

---

## Architecture

### Component tree

```
TimelinePreview (modified)
  └─ Section row
       ├─ tag, duration, clip thumbnails (existing)
       ├─ NEW: 🔒 icon if section.userLocked
       ├─ NEW: ⚠ icon + yellow border if max(clip.speedFactor) > 2.0
       ├─ NEW: 📋 Browse button (opens SectionEditorDialog)
       └─ 🔄 Reroll button (modified — confirm if userLocked)

SectionEditorDialog (NEW, shadcn Dialog)
  ├─ Header — "Edit section: {tag} ({sectionDuration}s)"
  ├─ ChainStrip (NEW) — current draft chain, slot picker focus state
  ├─ Body (2-pane)
  │    ├─ VariantGrid (NEW) — thumbnails of all variants for tag
  │    └─ PreviewPane (NEW) — large <video> + duration + "Use for slot N"
  ├─ Footer — total duration, computed speedFactor, save/cancel
  └─ Validation banner — shown when speedFactor < MIN_SPEED_FACTOR
```

### State changes

#### `MatchedSection` (in `src/lib/auto-match.ts`)

Add optional flag:

```ts
export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
  userLocked?: boolean; // NEW
}
```

`matchSections(...)` always returns `userLocked: undefined` (defaults to falsy). Set to `true` only by Section Editor save action.

#### Constants (new file or top of `auto-match.ts`)

```ts
export const HIGH_SPEED_THRESHOLD = 2.0; // visual warning above this
export const MIN_SPEED_FACTOR = 0.8;     // minimum allowed (slow-down floor)
```

### Helper functions (new, in `auto-match.ts` or sibling file)

```ts
// Given a chain of clip metadata + section duration, compute uniform speed factor.
export function computeChainSpeed(chainDurations: number[], sectionMs: number): number;

// Build MatchedClip[] from picked chain with uniform speed.
export function buildManualChain(
  picks: ClipMetadata[],
  sectionMs: number
): MatchedClip[];

// Validation: returns null if OK, or { code: "TOO_SLOW", message: string }.
export function validateChain(
  chainDurations: number[],
  sectionMs: number
): { code: string; message: string } | null;
```

These keep the modal's logic pure-testable and reuse existing speed-factor math.

---

## Data flow

### Loading variants

When `SectionEditorDialog` mounts:

1. Fetch `GET /api/products/${productId}/clips`.
2. Filter client-side: `deriveBaseName(clip.brollName) === section.tag.toLowerCase()`.
3. Sort variants by `brollName` ascending (deterministic order).
4. Cache result in modal state. No re-fetch unless modal closes & re-opens.

### Loading thumbnails (variant grid)

Each grid tile uses the existing `<ClipThumb>` pattern: `getThumbnail(clipId)` from IndexedDB → blob URL → `<img>`. Already in use.

### Loading video for preview

When user clicks a tile, PreviewPane:

1. Calls `getClip(clipId)` → ArrayBuffer.
2. Creates `Blob([buf], { type: "video/mp4" })` → `URL.createObjectURL`.
3. Sets `<video>` `src`, with `controls`, no autoplay.
4. Tracks created URLs and revokes them on:
   - Tile click (replace previous URL before creating new one).
   - Modal close.

### Saving

On **Save** click:

1. Build `MatchedClip[]` via `buildManualChain(draftPicks, section.durationMs)`.
2. Construct updated `MatchedSection` with `clips`, `userLocked: true`.
3. Call `onTimelineChange(timeline.map((s, i) => i === sectionIndex ? updated : s))` — same prop already used by reroll.
4. Close modal, revoke any preview blob URLs.

### Reroll behavior

`reroll(sectionIndex)` in `TimelinePreview`:

```ts
async function reroll(sectionIndex: number) {
  const section = timeline[sectionIndex];
  if (section.userLocked) {
    const ok = await confirmDialog("This section was set manually. Reset to auto-pick?");
    if (!ok) return;
  }
  // existing reroll logic
  // resulting section has userLocked: undefined
}
```

`confirmDialog` is a new wrapper around shadcn `AlertDialog` (resolve true/false promise).

---

## Validation rules

When user saves a chain:

| Condition | Result |
|---|---|
| `chain.length === 0` (all slots removed) | Save allowed; section's `clips` becomes `[{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1.0, isPlaceholder: true }]` — same shape as a tag-not-found placeholder, renders as black. Show in-modal warning "Section will render as black frames". |
| `total / sectionMs < MIN_SPEED_FACTOR` (i.e., chain too short → would slow below 0.8×) | **Reject save.** Show banner: "Chain too short. Add another clip or pick a longer variant." |
| `total / sectionMs > HIGH_SPEED_THRESHOLD` | Save allowed with warning banner: "Speed >2× — may distort. Consider adding more clips." Section gets yellow border after save. |
| Otherwise | Save normally. |

The 0.8× floor is a one-line check using the new `validateChain` helper.

---

## UI details

### ChainStrip

- Horizontal strip of slot tiles, each ~80×100px.
- Tile content: thumbnail, filename (truncated), duration, ✕ button (top-right corner on hover).
- "Active slot" (the one currently being picked-for) has a colored ring.
- Trailing **+** tile (dashed border, plus icon) opens an empty new slot in active state.

### VariantGrid

- Grid of thumbnails, ~120×150px tiles, gap-2, ~4-5 cols.
- Tile content: thumbnail, filename, duration badge.
- Click → loads in PreviewPane and highlights tile.
- "Already in chain" tiles get a small badge (e.g., "✓ in chain") but stay clickable (user might want duplicates).

### PreviewPane

- Container ~480×600px (sized for portrait b-roll which is the project's default 1080×1350).
- HTML5 `<video>` with `controls`, no autoplay, `playsInline`.
- Below video: filename, duration, dimensions (from clip metadata), and primary action button:
  - If chain has active "picking" slot: **Use for slot N**.
  - If active slot is the trailing **+**: **Add to chain**.

### Section row in timeline

Modified [`src/components/build/timeline-preview.tsx`](../../../src/components/build/timeline-preview.tsx):

```tsx
const maxSpeed = Math.max(...section.clips.map(c => c.speedFactor), 1);
const isHighSpeed = maxSpeed > HIGH_SPEED_THRESHOLD;
const isLocked = !!section.userLocked;

<div className={cn(
  "flex items-center gap-3 p-3 border rounded-lg",
  isHighSpeed && "border-yellow-500 bg-yellow-50/30 dark:bg-yellow-950/10"
)}>
  <span>{i + 1}</span>
  <span className="tag-badge">{section.tag}</span>
  {isLocked && <Lock className="w-3 h-3 text-blue-500" title="Manually set" />}
  {isHighSpeed && <AlertTriangle className="w-4 h-4 text-yellow-600" title="Speed >2× — may distort" />}
  <span>{formatMs(section.durationMs)}</span>
  {/* thumbnails */}
  <button onClick={() => openEditor(i)} title="Browse variants"><Layers /></button>
  <button onClick={() => reroll(i)} title="Re-roll"><RefreshCw /></button>
</div>
```

(Icon for browse button: `Layers` from lucide — visually distinct from the refresh icon.)

---

## Edge cases

| Case | Handling |
|---|---|
| Tag has no variants | Modal opens with empty grid + message: "No b-rolls found for tag '{tag}'. Upload some first." Save disabled. |
| User opens modal, deletes all clips in another tab, re-opens | Re-fetch happens on each modal open; grid reflects current state. |
| User saves chain identical to current auto-pick | Section still gets `userLocked: true`. (Flag indicates "user has approved this," even if same content.) |
| Section is a placeholder (`isPlaceholder: true`) | Browse button still works. Modal lets user pick variant(s) → placeholder replaced. After save, no longer placeholder. |
| Variant deleted between modal open and save | On save, validate clip IDs still exist; if not, show error and remove from chain. |
| Modal open across product change | `productId` is bound when modal opens. If user navigates away, modal closes via parent unmount. |

---

## Testing strategy

### Unit tests (`src/lib/__tests__/auto-match.test.ts`)

- `computeChainSpeed`: empty chain, single, multiple, exact match (1.0×).
- `validateChain`: above floor, exactly at floor (0.8×), below floor (rejected), exactly at high threshold.
- `buildManualChain`: produces uniform speedFactor across all clips.
- `MatchedSection.userLocked` round-trips through helper functions.

### Component tests (`src/components/build/__tests__/`)

- `SectionEditorDialog`:
  - Renders variants for given tag.
  - Click variant → loads in preview pane.
  - Click "Use for slot N" → chain updates.
  - Add slot, remove slot, recompute footer.
  - Validation banner appears when below floor; save button disabled.
  - Save calls `onTimelineChange` with `userLocked: true`.
- `TimelinePreview`:
  - Yellow border applied when any clip speedFactor > 2.0.
  - 🔒 icon shown when section.userLocked.
  - Reroll on locked section → confirm dialog flow.

### Manual verification

- Edit a section in real workspace, save, render → confirm chosen clip appears in output.
- Build a chain of 3 clips, save, render → confirm uniform speed applied.
- Try to save chain at 0.7× → blocked with banner.

---

## Out of scope (future work)

- Hover-autoplay variant previews (lightweight TikTok-feed style).
- Bulk operations: "lock all current picks", "reroll all unlocked".
- Persisting locks across page reload (would require timeline serialization).
- Per-clip trim within a slot.
- Drag-reorder of chain slots.
