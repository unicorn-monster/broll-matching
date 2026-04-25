# Section Editor Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user manually pick b-roll variants per section via a modal browser, edit chains slot-by-slot, and surface visual flags for high-speed sections (>2×) and manually-locked sections.

**Architecture:** Add a shadcn `Dialog`-based `SectionEditorDialog` triggered from each timeline section row. Keep all per-modal state local (draft chain, selected variant). On save, the dialog updates the parent's `MatchedSection` via existing `onTimelineChange`, marking it `userLocked`. Pure helpers (`computeChainSpeed`, `validateChain`, `buildManualChain`) live in `src/lib/auto-match.ts` for TDD coverage. Visual flags piggy-back on the existing `TimelinePreview` row markup.

**Tech Stack:** React 19, Next.js App Router, shadcn/ui (Dialog), Tailwind, lucide-react icons, idb (IndexedDB), vitest.

**Spec:** [`docs/superpowers/specs/2026-04-25-section-editor-modal-design.md`](../specs/2026-04-25-section-editor-modal-design.md)

---

## File Structure

**New files:**
- `src/components/build/section-editor/section-editor-dialog.tsx` — main modal
- `src/components/build/section-editor/chain-strip.tsx` — top strip of draft chain slots
- `src/components/build/section-editor/variant-grid.tsx` — grid of variant thumbnails
- `src/components/build/section-editor/preview-pane.tsx` — video player + use button
- `src/components/build/__tests__/section-editor-helpers.test.ts` — helper unit tests
- (Optional component tests can be added but are not required for plan completion)

**Modified files:**
- `src/lib/auto-match.ts` — add `userLocked` to `MatchedSection`, new constants and helpers
- `src/lib/__tests__/auto-match.test.ts` — extend with helper tests
- `src/components/build/timeline-preview.tsx` — add browse button, lock icon, yellow border, reroll-confirm

**No API or schema changes.**

---

## Task 1: Add constants and `userLocked` field to types

**Files:**
- Modify: `src/lib/auto-match.ts`

- [ ] **Step 1: Add the constants near the top of the file**

After the existing imports in `src/lib/auto-match.ts` (after line 2), add:

```ts
/** Sections with any clip whose speedFactor exceeds this get a visual warning. */
export const HIGH_SPEED_THRESHOLD = 2.0;

/** Minimum allowed speedFactor when user manually builds a chain. Below this, save is rejected. */
export const MIN_SPEED_FACTOR = 0.8;
```

- [ ] **Step 2: Add `userLocked` field to `MatchedSection` interface**

Modify the `MatchedSection` interface to:

```ts
export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
  userLocked?: boolean;
}
```

- [ ] **Step 3: Run typecheck to confirm nothing else broke**

Run: `pnpm typecheck`
Expected: Same pre-existing errors as before (script-parser tests, render-worker), no new errors related to `auto-match.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auto-match.ts
git commit -m "feat(auto-match): add HIGH_SPEED_THRESHOLD, MIN_SPEED_FACTOR, userLocked field"
```

---

## Task 2: Implement `computeChainSpeed` helper (TDD)

**Files:**
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/auto-match.ts`

- [ ] **Step 1: Write failing tests for `computeChainSpeed`**

Add at the bottom of `src/lib/__tests__/auto-match.test.ts`, before the final `});` of the outermost describe (or as a new top-level `describe`):

```ts
import { computeChainSpeed } from "../auto-match";

describe("computeChainSpeed", () => {
  it("returns 1.0 for an exact-match single clip", () => {
    expect(computeChainSpeed([5000], 5000)).toBe(1);
  });

  it("returns clip/section ratio for single clip longer than section", () => {
    expect(computeChainSpeed([8000], 4000)).toBe(2);
  });

  it("returns slow-down ratio (<1) for single clip shorter than section", () => {
    expect(computeChainSpeed([3000], 5000)).toBeCloseTo(0.6, 2);
  });

  it("returns total/section ratio for multi-clip chain", () => {
    expect(computeChainSpeed([2500, 3400], 5000)).toBeCloseTo(1.18, 2);
  });

  it("returns 0 for empty chain", () => {
    expect(computeChainSpeed([], 5000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: FAIL with "computeChainSpeed is not a function" or import error.

- [ ] **Step 3: Implement `computeChainSpeed`**

Add to `src/lib/auto-match.ts` (anywhere after the constants):

```ts
export function computeChainSpeed(chainDurations: number[], sectionMs: number): number {
  if (chainDurations.length === 0) return 0;
  const total = chainDurations.reduce((sum, d) => sum + d, 0);
  return total / sectionMs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: PASS for the 5 new tests + all existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): add computeChainSpeed helper"
```

---

## Task 3: Implement `validateChain` helper (TDD)

**Files:**
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/auto-match.ts`

- [ ] **Step 1: Write failing tests for `validateChain`**

Add to `src/lib/__tests__/auto-match.test.ts`:

```ts
import { validateChain } from "../auto-match";

describe("validateChain", () => {
  it("returns null when speed exactly at MIN_SPEED_FACTOR (0.8)", () => {
    expect(validateChain([4000], 5000)).toBeNull();
  });

  it("returns TOO_SLOW error when speed below 0.8", () => {
    const result = validateChain([3500], 5000); // 0.7×
    expect(result).not.toBeNull();
    expect(result!.code).toBe("TOO_SLOW");
    expect(result!.message).toMatch(/too short/i);
  });

  it("returns null for chain at exactly section duration (1.0×)", () => {
    expect(validateChain([5000], 5000)).toBeNull();
  });

  it("returns null for high speed-up (no upper cap)", () => {
    expect(validateChain([20000], 5000)).toBeNull(); // 4×
  });

  it("returns EMPTY error for empty chain", () => {
    const result = validateChain([], 5000);
    expect(result).not.toBeNull();
    expect(result!.code).toBe("EMPTY");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: FAIL with "validateChain is not a function".

- [ ] **Step 3: Implement `validateChain`**

Add to `src/lib/auto-match.ts`:

```ts
export interface ChainValidationError {
  code: "EMPTY" | "TOO_SLOW";
  message: string;
}

export function validateChain(
  chainDurations: number[],
  sectionMs: number,
): ChainValidationError | null {
  if (chainDurations.length === 0) {
    return { code: "EMPTY", message: "Chain is empty. Add at least one clip." };
  }
  const speed = computeChainSpeed(chainDurations, sectionMs);
  if (speed < MIN_SPEED_FACTOR) {
    return {
      code: "TOO_SLOW",
      message: `Chain too short. Add another clip or pick a longer variant (current speed ${speed.toFixed(2)}× < ${MIN_SPEED_FACTOR}×).`,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: PASS for all 5 new tests + all prior tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): add validateChain with EMPTY and TOO_SLOW errors"
```

---

## Task 4: Implement `buildManualChain` helper (TDD)

**Files:**
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/auto-match.ts`

- [ ] **Step 1: Write failing tests for `buildManualChain`**

Add to `src/lib/__tests__/auto-match.test.ts`:

```ts
import { buildManualChain } from "../auto-match";

describe("buildManualChain", () => {
  const clipA = { id: "a", indexeddbKey: "a-key", durationMs: 2500 } as ClipMetadata;
  const clipB = { id: "b", indexeddbKey: "b-key", durationMs: 3400 } as ClipMetadata;

  it("produces uniform speedFactor across all picks", () => {
    const chain = buildManualChain([clipA, clipB], 5000);
    expect(chain).toHaveLength(2);
    const expected = (2500 + 3400) / 5000;
    expect(chain[0].speedFactor).toBeCloseTo(expected, 4);
    expect(chain[1].speedFactor).toBeCloseTo(expected, 4);
  });

  it("preserves clipId and indexeddbKey for each pick in order", () => {
    const chain = buildManualChain([clipA, clipB], 5000);
    expect(chain[0].clipId).toBe("a");
    expect(chain[0].indexeddbKey).toBe("a-key");
    expect(chain[1].clipId).toBe("b");
    expect(chain[1].indexeddbKey).toBe("b-key");
  });

  it("sets isPlaceholder false for all picks", () => {
    const chain = buildManualChain([clipA], 2500);
    expect(chain[0].isPlaceholder).toBe(false);
  });

  it("returns single placeholder when picks is empty", () => {
    const chain = buildManualChain([], 5000);
    expect(chain).toHaveLength(1);
    expect(chain[0].isPlaceholder).toBe(true);
    expect(chain[0].clipId).toBe("placeholder");
    expect(chain[0].indexeddbKey).toBe("");
    expect(chain[0].speedFactor).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: FAIL with "buildManualChain is not a function".

- [ ] **Step 3: Implement `buildManualChain`**

Add to `src/lib/auto-match.ts`:

```ts
export function buildManualChain(picks: ClipMetadata[], sectionMs: number): MatchedClip[] {
  if (picks.length === 0) {
    return [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1, isPlaceholder: true }];
  }
  const speedFactor = computeChainSpeed(picks.map((p) => p.durationMs), sectionMs);
  return picks.map((p) => ({
    clipId: p.id,
    indexeddbKey: p.indexeddbKey,
    speedFactor,
    isPlaceholder: false,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: PASS for all 4 new tests + all prior tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): add buildManualChain helper"
```

---

## Task 5: Add high-speed yellow border + ⚠ icon to timeline rows

**Files:**
- Modify: `src/components/build/timeline-preview.tsx`

- [ ] **Step 1: Update imports**

Modify `src/components/build/timeline-preview.tsx` line 4 (`import { RefreshCw }`) to:

```ts
import { RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { HIGH_SPEED_THRESHOLD } from "@/lib/auto-match";
```

(The existing `import { buildClipsByBaseName, ... } from "@/lib/auto-match"` line stays — just augment the same import or add a sibling import; pick whichever keeps the file tidy.)

- [ ] **Step 2: Replace the section row markup with high-speed warning**

Locate lines 76–103 (the `timeline.map((section, i) => ...)` block). Replace the opening `<div>` and add the icon. The full block becomes:

```tsx
{timeline.map((section, i) => {
  const maxSpeed = section.clips.length === 0
    ? 1
    : Math.max(...section.clips.map((c) => c.speedFactor));
  const isHighSpeed = maxSpeed > HIGH_SPEED_THRESHOLD;

  return (
    <div
      key={i}
      className={cn(
        "flex items-center gap-3 p-3 border rounded-lg",
        isHighSpeed && "border-yellow-500 bg-yellow-50/30 dark:bg-yellow-950/10",
        !isHighSpeed && "border-border",
      )}
    >
      <span className="text-xs font-mono w-6 text-muted-foreground">{i + 1}</span>
      <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">
        {section.tag}
      </span>
      {isHighSpeed && (
        <span
          title={`Speed ${maxSpeed.toFixed(2)}× — may distort audio/frames`}
          className="shrink-0"
        >
          <AlertTriangle className="w-4 h-4 text-yellow-600" />
        </span>
      )}
      <span className="text-xs text-muted-foreground shrink-0">{formatMs(section.durationMs)}</span>

      <div className="flex gap-1 flex-1 overflow-x-auto">
        {section.clips.map((clip, j) => (
          <div key={j} className="w-10 h-12 border border-border rounded overflow-hidden shrink-0 relative bg-muted">
            {clip.isPlaceholder ? (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">■</div>
            ) : (
              <ClipThumb clipId={clip.clipId} />
            )}
            {clip.speedFactor !== 1.0 && (
              <div className="absolute bottom-0 left-0 right-0 text-center bg-black/60 text-white text-[8px]">
                {clip.speedFactor.toFixed(1)}x
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => reroll(i)} className="shrink-0 text-muted-foreground hover:text-primary" title="Re-roll">
        <RefreshCw className="w-4 h-4" />
      </button>
    </div>
  );
})}
```

- [ ] **Step 3: Smoke-test in dev**

Run: `pnpm dev`
Open the build page with a script that produces a section needing >2× speed (e.g., a 1s section with only 5s clips). Confirm the row has yellow border and ⚠ icon. Stop dev server.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: No new errors in `timeline-preview.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/build/timeline-preview.tsx
git commit -m "feat(timeline): yellow border + warning icon for sections needing >2x speed"
```

---

## Task 6: Add 🔒 lock icon for `userLocked` sections

**Files:**
- Modify: `src/components/build/timeline-preview.tsx`

- [ ] **Step 1: Add `Lock` to imports**

In `src/components/build/timeline-preview.tsx`, change the lucide import line to:

```ts
import { RefreshCw, AlertTriangle, Lock } from "lucide-react";
```

- [ ] **Step 2: Render lock icon when `section.userLocked`**

Inside the section row markup (added in Task 5), right after the `tag` badge `<span>`, insert the lock icon block. The inserted lines (place between the tag span and the `isHighSpeed && <AlertTriangle ... />` block):

```tsx
{section.userLocked && (
  <span title="Manually set" className="shrink-0">
    <Lock className="w-3.5 h-3.5 text-blue-500" />
  </span>
)}
```

- [ ] **Step 3: Manual smoke-test**

Run: `pnpm dev`
In React DevTools (or temporarily hardcode in a test), set `userLocked: true` on a section to confirm icon renders. Revert any test edit. Stop dev.

- [ ] **Step 4: Commit**

```bash
git add src/components/build/timeline-preview.tsx
git commit -m "feat(timeline): show lock icon for manually-set sections"
```

---

## Task 7: Add reroll-confirm dialog for locked sections

**Files:**
- Modify: `src/components/build/timeline-preview.tsx`

- [ ] **Step 1: Add Dialog imports and state**

At the top of `src/components/build/timeline-preview.tsx`, add the Dialog imports:

```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Add confirm state in `TimelinePreview`**

Inside the `TimelinePreview` function component body (just before the existing `async function reroll(...)`), add:

```ts
const [confirmRerollIdx, setConfirmRerollIdx] = useState<number | null>(null);
```

(`useState` is already imported at line 3.)

- [ ] **Step 3: Refactor `reroll` to extract logic and gate on confirm**

Replace the existing `reroll` function with:

```ts
async function performReroll(sectionIndex: number) {
  const section = timeline[sectionIndex];
  const clipsRes = await fetch(`/api/products/${productId}/clips`);
  const rawClips = await clipsRes.json();
  const clips: ClipMetadata[] = rawClips.map((c: any) => ({
    ...c,
    baseName: deriveBaseName(c.brollName),
    createdAt: new Date(c.createdAt),
  }));
  const map = buildClipsByBaseName(clips);
  const fakeSection: ParsedSection = {
    lineNumber: sectionIndex + 1,
    startTime: 0,
    endTime: section.durationMs / 1000,
    tag: section.tag,
    scriptText: "",
    durationMs: section.durationMs,
  };
  const [rerolled] = matchSections([fakeSection], map);
  // userLocked is intentionally not carried over — reroll always returns to auto state.
  onTimelineChange(timeline.map((s, i) => (i === sectionIndex ? rerolled : s)));
}

function reroll(sectionIndex: number) {
  if (timeline[sectionIndex].userLocked) {
    setConfirmRerollIdx(sectionIndex);
    return;
  }
  void performReroll(sectionIndex);
}
```

- [ ] **Step 4: Render the confirm dialog**

At the end of the `return (...)` block in `TimelinePreview`, just before the closing `</div>` of the outermost wrapper, add:

```tsx
<Dialog
  open={confirmRerollIdx !== null}
  onOpenChange={(open) => { if (!open) setConfirmRerollIdx(null); }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Reset to auto-pick?</DialogTitle>
      <DialogDescription>
        This section was set manually. Re-rolling will replace your pick with a random variant.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => setConfirmRerollIdx(null)}>Cancel</Button>
      <Button
        onClick={() => {
          const idx = confirmRerollIdx;
          setConfirmRerollIdx(null);
          if (idx !== null) void performReroll(idx);
        }}
      >
        Reset
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 6: Manual smoke-test**

Run: `pnpm dev`. With dev tools, force a section to `userLocked: true`. Click 🔄 reroll → confirm dialog appears. Click Cancel → dialog closes, section unchanged. Click reroll → confirm again → click Reset → reroll runs and lock clears.

- [ ] **Step 7: Commit**

```bash
git add src/components/build/timeline-preview.tsx
git commit -m "feat(timeline): confirm dialog before rerolling a manually-locked section"
```

---

## Task 8: Build `VariantGrid` component

**Files:**
- Create: `src/components/build/section-editor/variant-grid.tsx`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p src/components/build/section-editor`

- [ ] **Step 2: Write `variant-grid.tsx`**

Create `src/components/build/section-editor/variant-grid.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
import { formatMs } from "@/lib/format-time";
import type { ClipMetadata } from "@/lib/auto-match";

interface VariantGridProps {
  variants: ClipMetadata[];
  selectedClipId: string | null;
  onSelect: (clip: ClipMetadata) => void;
  inChainIds: Set<string>;
}

export function VariantGrid({ variants, selectedClipId, onSelect, inChainIds }: VariantGridProps) {
  if (variants.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-8 text-center">
        No b-rolls found for this tag. Upload some first.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 overflow-y-auto p-1">
      {variants.map((clip) => (
        <VariantTile
          key={clip.id}
          clip={clip}
          selected={clip.id === selectedClipId}
          inChain={inChainIds.has(clip.id)}
          onClick={() => onSelect(clip)}
        />
      ))}
    </div>
  );
}

function VariantTile({
  clip,
  selected,
  inChain,
  onClick,
}: {
  clip: ClipMetadata;
  selected: boolean;
  inChain: boolean;
  onClick: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    getThumbnail(clip.id).then((buf) => {
      if (buf) {
        url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        setSrc(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [clip.id]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-stretch text-left rounded-md border overflow-hidden transition",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground",
      )}
    >
      <div className="aspect-[4/5] bg-muted">
        {src && <img src={src} alt={clip.brollName} className="w-full h-full object-cover" />}
      </div>
      <div className="px-2 py-1 text-xs">
        <div className="truncate font-medium">{clip.brollName}</div>
        <div className="text-muted-foreground">{formatMs(clip.durationMs)}</div>
      </div>
      {inChain && (
        <div className="absolute top-1 right-1 text-[10px] bg-primary text-primary-foreground rounded px-1 py-0.5">
          ✓ in chain
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: no new errors related to this file.

- [ ] **Step 4: Commit**

```bash
git add src/components/build/section-editor/variant-grid.tsx
git commit -m "feat(section-editor): variant grid component"
```

---

## Task 9: Build `PreviewPane` component

**Files:**
- Create: `src/components/build/section-editor/preview-pane.tsx`

- [ ] **Step 1: Write `preview-pane.tsx`**

Create `src/components/build/section-editor/preview-pane.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getClip } from "@/lib/clip-storage";
import { formatMs } from "@/lib/format-time";
import type { ClipMetadata } from "@/lib/auto-match";

interface PreviewPaneProps {
  clip: ClipMetadata | null;
  /** Label for the action button — e.g. "Use for slot 1" or "Add to chain". */
  actionLabel: string;
  /** Disabled when no active slot is selected. */
  actionDisabled?: boolean;
  onUse: () => void;
}

export function PreviewPane({ clip, actionLabel, actionDisabled, onUse }: PreviewPaneProps) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!clip) {
      setVideoSrc(null);
      return;
    }
    let url: string | null = null;
    let active = true;
    getClip(clip.id).then((buf) => {
      if (!active || !buf) return;
      url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
      setVideoSrc(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      setVideoSrc(null);
    };
  }, [clip?.id]);

  if (!clip) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-8 text-center border border-dashed border-border rounded-md">
        Select a variant on the left to preview.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1 bg-black rounded-md overflow-hidden flex items-center justify-center">
        {videoSrc ? (
          <video
            key={clip.id}
            src={videoSrc}
            controls
            playsInline
            className="max-w-full max-h-full"
          />
        ) : (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}
      </div>
      <div className="text-sm space-y-0.5">
        <div className="font-medium truncate">{clip.brollName}</div>
        <div className="text-muted-foreground text-xs">
          {formatMs(clip.durationMs)} · {clip.width}×{clip.height}
        </div>
      </div>
      <Button onClick={onUse} disabled={actionDisabled} className="w-full">
        {actionLabel}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/section-editor/preview-pane.tsx
git commit -m "feat(section-editor): preview pane with video player"
```

---

## Task 10: Build `ChainStrip` component

**Files:**
- Create: `src/components/build/section-editor/chain-strip.tsx`

- [ ] **Step 1: Write `chain-strip.tsx`**

Create `src/components/build/section-editor/chain-strip.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThumbnail } from "@/lib/clip-storage";
import { formatMs } from "@/lib/format-time";
import type { ClipMetadata } from "@/lib/auto-match";

/**
 * `activeSlot` semantics:
 *   - integer in [0, picks.length): user is editing that slot
 *   - picks.length: user is adding a new slot (the "+" tile)
 *   - null: no slot active
 */
interface ChainStripProps {
  picks: ClipMetadata[];
  activeSlot: number | null;
  onActivateSlot: (slot: number) => void;
  onActivateAdd: () => void;
  onRemoveSlot: (slot: number) => void;
}

export function ChainStrip({ picks, activeSlot, onActivateSlot, onActivateAdd, onRemoveSlot }: ChainStripProps) {
  return (
    <div className="flex gap-2 overflow-x-auto p-1 border-b border-border">
      {picks.map((clip, i) => (
        <SlotTile
          key={`${i}-${clip.id}`}
          clip={clip}
          slotIndex={i}
          active={activeSlot === i}
          onClick={() => onActivateSlot(i)}
          onRemove={() => onRemoveSlot(i)}
        />
      ))}
      <button
        type="button"
        onClick={onActivateAdd}
        className={cn(
          "shrink-0 w-20 h-28 rounded-md border-2 border-dashed flex items-center justify-center transition",
          activeSlot === picks.length
            ? "border-primary text-primary"
            : "border-border text-muted-foreground hover:border-muted-foreground",
        )}
        aria-label="Add clip to chain"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}

function SlotTile({
  clip,
  slotIndex,
  active,
  onClick,
  onRemove,
}: {
  clip: ClipMetadata;
  slotIndex: number;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    getThumbnail(clip.id).then((buf) => {
      if (buf) {
        url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
        setSrc(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [clip.id]);

  return (
    <div
      className={cn(
        "relative shrink-0 w-20 h-28 rounded-md border overflow-hidden cursor-pointer transition",
        active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-muted-foreground",
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <div className="absolute top-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 z-10">
        slot {slotIndex + 1}
      </div>
      <div className="w-full h-full bg-muted">
        {src && <img src={src} alt={clip.brollName} className="w-full h-full object-cover" />}
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
        {formatMs(clip.durationMs)}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-1 right-1 z-20 bg-black/60 hover:bg-red-500 text-white rounded p-0.5"
        aria-label={`Remove slot ${slotIndex + 1}`}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/section-editor/chain-strip.tsx
git commit -m "feat(section-editor): chain strip component"
```

---

## Task 11: Build `SectionEditorDialog`

**Files:**
- Create: `src/components/build/section-editor/section-editor-dialog.tsx`

- [ ] **Step 1: Write `section-editor-dialog.tsx`**

Create `src/components/build/section-editor/section-editor-dialog.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveBaseName } from "@/lib/broll";
import { formatMs } from "@/lib/format-time";
import {
  buildManualChain,
  computeChainSpeed,
  HIGH_SPEED_THRESHOLD,
  validateChain,
  type ClipMetadata,
  type MatchedClip,
  type MatchedSection,
} from "@/lib/auto-match";
import { VariantGrid } from "./variant-grid";
import { PreviewPane } from "./preview-pane";
import { ChainStrip } from "./chain-strip";

interface SectionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  section: MatchedSection;
  /** Map current clips array → ClipMetadata for initial picks. Caller passes an async resolver. */
  resolveSectionClips: (clips: MatchedClip[]) => Promise<ClipMetadata[]>;
  onSave: (newClips: MatchedClip[]) => void;
}

export function SectionEditorDialog({
  open,
  onOpenChange,
  productId,
  section,
  resolveSectionClips,
  onSave,
}: SectionEditorDialogProps) {
  const [variants, setVariants] = useState<ClipMetadata[]>([]);
  const [picks, setPicks] = useState<ClipMetadata[]>([]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [selectedClip, setSelectedClip] = useState<ClipMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  // Load variants + initial picks each time dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [variantsRes, initialPicks] = await Promise.all([
          fetch(`/api/products/${productId}/clips`).then((r) => r.json()),
          resolveSectionClips(section.clips),
        ]);
        if (cancelled) return;
        const allClips: ClipMetadata[] = variantsRes.map((c: any) => ({
          ...c,
          baseName: deriveBaseName(c.brollName),
          createdAt: new Date(c.createdAt),
        }));
        const tagKey = section.tag.toLowerCase();
        const filtered = allClips
          .filter((c) => deriveBaseName(c.brollName) === tagKey)
          .sort((a, b) => a.brollName.localeCompare(b.brollName));
        setVariants(filtered);
        setPicks(initialPicks);
        setActiveSlot(null);
        setSelectedClip(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, productId, section.tag, section.clips, resolveSectionClips]);

  const inChainIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);

  const chainDurations = picks.map((p) => p.durationMs);
  const speed = computeChainSpeed(chainDurations, section.durationMs);
  const validation = validateChain(chainDurations, section.durationMs);
  const isHighSpeed = speed > HIGH_SPEED_THRESHOLD;

  const totalMs = chainDurations.reduce((s, d) => s + d, 0);

  function handleSelectVariant(clip: ClipMetadata) {
    setSelectedClip(clip);
  }

  function handleUseInActiveSlot() {
    if (!selectedClip || activeSlot === null) return;
    if (activeSlot === picks.length) {
      // Add new slot
      setPicks([...picks, selectedClip]);
      setActiveSlot(null);
    } else {
      // Replace existing slot
      setPicks(picks.map((p, i) => (i === activeSlot ? selectedClip : p)));
      setActiveSlot(null);
    }
    setSelectedClip(null);
  }

  function handleRemoveSlot(slot: number) {
    setPicks(picks.filter((_, i) => i !== slot));
    if (activeSlot === slot) setActiveSlot(null);
    if (activeSlot !== null && activeSlot > slot) setActiveSlot(activeSlot - 1);
  }

  function handleSave() {
    if (validation && validation.code === "TOO_SLOW") return; // blocked
    const chain = buildManualChain(picks, section.durationMs);
    onSave(chain);
    onOpenChange(false);
  }

  const actionLabel =
    activeSlot === null
      ? "Select a slot first"
      : activeSlot === picks.length
        ? "Add to chain"
        : `Use for slot ${activeSlot + 1}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-[90vw] max-h-[90vh] flex flex-col gap-4"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>Edit section: {section.tag} ({formatMs(section.durationMs)})</DialogTitle>
          <DialogDescription>
            Pick variants for each slot. System will speed up uniformly to fit section duration.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
        ) : (
          <>
            <ChainStrip
              picks={picks}
              activeSlot={activeSlot}
              onActivateSlot={(slot) => {
                setActiveSlot(slot);
                setSelectedClip(picks[slot] ?? null);
              }}
              onActivateAdd={() => {
                setActiveSlot(picks.length);
                setSelectedClip(null);
              }}
              onRemoveSlot={handleRemoveSlot}
            />

            <div className="grid grid-cols-[1fr_auto] gap-4 flex-1 min-h-0">
              <div className="min-h-0 overflow-y-auto">
                <VariantGrid
                  variants={variants}
                  selectedClipId={selectedClip?.id ?? null}
                  onSelect={handleSelectVariant}
                  inChainIds={inChainIds}
                />
              </div>
              <div className="w-[360px]">
                <PreviewPane
                  clip={selectedClip}
                  actionLabel={actionLabel}
                  actionDisabled={!selectedClip || activeSlot === null}
                  onUse={handleUseInActiveSlot}
                />
              </div>
            </div>
          </>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-border pt-3">
          <div className="text-xs">
            <span className="text-muted-foreground">Chain total: </span>
            <span className="font-mono">{formatMs(totalMs)}</span>
            <span className="text-muted-foreground"> → </span>
            <span className={cn("font-mono", isHighSpeed && "text-yellow-600", validation?.code === "TOO_SLOW" && "text-red-500")}>
              {speed.toFixed(2)}× speed
            </span>
            {validation && (
              <span className="ml-2 text-red-500">{validation.message}</span>
            )}
            {!validation && isHighSpeed && (
              <span className="ml-2 text-yellow-600">Speed &gt;2× — may distort. Consider adding more clips.</span>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!!validation && validation.code === "TOO_SLOW"}
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: no new errors related to `section-editor` files.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/section-editor/section-editor-dialog.tsx
git commit -m "feat(section-editor): assemble dialog with chain editor + variant grid + preview"
```

---

## Task 12: Wire `SectionEditorDialog` into `TimelinePreview`

**Files:**
- Modify: `src/components/build/timeline-preview.tsx`

- [ ] **Step 1: Add imports**

Add to imports in `src/components/build/timeline-preview.tsx`:

```ts
import { Layers } from "lucide-react";
import { SectionEditorDialog } from "./section-editor/section-editor-dialog";
import type { MatchedClip } from "@/lib/auto-match";
```

(Adjust the existing `lucide-react` import to include `Layers` alongside `RefreshCw`, `AlertTriangle`, `Lock`.)

- [ ] **Step 2: Add editor state in `TimelinePreview`**

Inside the function body, alongside `confirmRerollIdx`, add:

```ts
const [editingIdx, setEditingIdx] = useState<number | null>(null);
```

- [ ] **Step 3: Add `resolveSectionClips` helper (memoized)**

Add `useCallback` to the existing `useState` import line at the top of the file:

```ts
import { useState, useEffect, useCallback } from "react";
```

Inside the function body (above the `return`), add:

```ts
const resolveSectionClips = useCallback(async (clips: MatchedClip[]): Promise<ClipMetadata[]> => {
  const real = clips.filter((c) => !c.isPlaceholder);
  if (real.length === 0) return [];
  const res = await fetch(`/api/products/${productId}/clips`);
  const raw = await res.json();
  const byId = new Map<string, ClipMetadata>();
  for (const c of raw) {
    byId.set(c.id, {
      ...c,
      baseName: deriveBaseName(c.brollName),
      createdAt: new Date(c.createdAt),
    });
  }
  return real.flatMap((c) => {
    const meta = byId.get(c.clipId);
    return meta ? [meta] : [];
  });
}, [productId]);

function handleSectionSave(sectionIndex: number, newClips: MatchedClip[]) {
  onTimelineChange(
    timeline.map((s, i) =>
      i === sectionIndex
        ? { ...s, clips: newClips, userLocked: true }
        : s,
    ),
  );
  setEditingIdx(null);
}
```

- [ ] **Step 4: Add browse button to each row**

In the section row markup (added in Task 5), insert a new button between the thumbnails `<div>` and the existing reroll `<button>`:

```tsx
<button
  onClick={() => setEditingIdx(i)}
  className="shrink-0 text-muted-foreground hover:text-primary"
  title="Browse variants"
>
  <Layers className="w-4 h-4" />
</button>
```

- [ ] **Step 5: Render the dialog**

At the end of the `return (...)` block (alongside the confirm dialog from Task 7), add:

```tsx
{editingIdx !== null && (
  <SectionEditorDialog
    open={editingIdx !== null}
    onOpenChange={(open) => { if (!open) setEditingIdx(null); }}
    productId={productId}
    section={timeline[editingIdx]}
    resolveSectionClips={resolveSectionClips}
    onSave={(newClips) => handleSectionSave(editingIdx, newClips)}
  />
)}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/build/timeline-preview.tsx
git commit -m "feat(timeline): wire section editor dialog to browse button"
```

---

## Task 13: End-to-end manual verification

**Files:** none modified.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Verify auto-match still works (no regressions)**

Open the build page, paste a script with several tags, check that timeline auto-fills as before. Confirm sections without `userLocked` have **no** lock icon.

- [ ] **Step 3: Verify high-speed warning**

Find or create a section where a single clip needs >2× speed. Confirm the row has a yellow border and ⚠ icon with tooltip.

- [ ] **Step 4: Verify browse button + single-pick**

Click the 📋 (Layers) icon on a section. Modal opens with variant grid + preview. Click a variant tile → it loads in the preview pane. Click an empty slot or "+" tile, click "Add to chain" → slot appended. Or click an existing slot, then a different variant, then "Use for slot N" → slot replaces. Save → modal closes, section row updates, 🔒 icon appears.

- [ ] **Step 5: Verify chain editing**

For a section that auto-matched as a chain, open editor. Confirm strip shows multiple slots. Add a new slot via "+", remove a slot via X. Confirm footer recomputes total/speed. Save. Section row reflects the new chain.

- [ ] **Step 6: Verify validation**

Build a chain whose total < 0.8× section duration (e.g., one 2s clip for a 5s section). Save button should be disabled with red TOO_SLOW message in footer.

- [ ] **Step 7: Verify reroll-confirm**

Click 🔄 Reroll on a section with 🔒 icon. Confirm dialog appears. Click Cancel — section unchanged. Click Reroll again, click Reset — reroll runs and 🔒 disappears.

- [ ] **Step 8: Verify render still works end-to-end**

After manually editing a section, click "Render" on the build page. Confirm output video uses the chosen clip(s) at the expected speed. (Use a short section for fast turnaround.)

- [ ] **Step 9: Stop dev server**

- [ ] **Step 10: Commit nothing — manual verification only**

Plan complete.

---

## Summary

13 tasks build the section editor modal incrementally:

- Tasks 1–4: pure logic (constants, helpers, types) — fully TDD'd
- Tasks 5–6: timeline visual flags (yellow border, lock icon)
- Task 7: reroll-confirm dialog
- Tasks 8–11: build the editor UI in 4 isolated components, then assemble
- Task 12: wire it into `TimelinePreview`
- Task 13: manual smoke test for the whole flow

Total commit count: 12 (Task 13 doesn't commit). Each commit leaves the codebase in a working state.
