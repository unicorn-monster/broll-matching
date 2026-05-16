# Talking-Head Overlay (Cutout PIP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `talking-head-overlay` layer kind that auto-removes background from a UGC mp4 in the browser and composites a bottom-right cutout over whatever else is playing.

**Architecture:** Browser-side MediaPipe Selfie Segmenter → WebCodecs VP9 alpha encode → WebM blob in IDB. Server-side ffmpeg consumes the matted webm as a second input and composites via `overlay` filter. Toolbar refactored from 1 dynamic "Add talking-head" button to 2 fixed pills (`full`, `overlay`).

**Tech Stack:** Next.js 15 App Router, TypeScript, vitest, IndexedDB (`idb`), MediaPipe `@mediapipe/tasks-vision`, WebCodecs API, `mp4box.js` (mp4 demux), `webm-muxer` (VP9 alpha WebM container), native ffmpeg via Node `child_process`.

**Spec:** [`docs/superpowers/specs/2026-05-16-talking-head-overlay-design.md`](../specs/2026-05-16-talking-head-overlay-design.md)

---

## File Map

### Modified
- `src/lib/talking-head/talking-head-types.ts` — add `kind`, matting fields
- `src/lib/talking-head/talking-head-store.ts` — kind-aware helpers, invariants
- `src/lib/talking-head/__tests__/talking-head-store.test.ts` — new test cases
- `src/lib/script-parser.ts` — multi-tag parsing + validators (`tag: string` → `tags: string[]`)
- `src/lib/__tests__/script-parser.test.ts` — multi-tag tests
- `src/lib/auto-match.ts` — read `tags[]`, emit `overlayClip`, propagate `isOverlay`
- `src/lib/__tests__/auto-match.test.ts` — overlay match tests
- `src/lib/media-storage.ts` — IDB v3, `matted-files` store + helpers
- `src/lib/__tests__/media-storage.test.ts` — v3 migration test
- `src/components/build/build-state-context.tsx` — `disabledOverlayShots` state + actions + matting worker integration
- `src/components/editor/toolbar/talking-head-layers-button.tsx` — replace with 2 fixed pills
- `src/components/editor/dialogs/add-talking-head-dialog.tsx` — strip to kind-aware
- `src/components/editor/inspector/talking-head-section-inspector.tsx` — matting status, restore button
- `src/components/editor/timeline/track-talking-head-layers.tsx` — overlay shot row + delete
- `src/app/api/render/route.ts` — accept `matted-clips`, branch for overlay segments
- `package.json` — add `@mediapipe/tasks-vision`, `mp4box`, `webm-muxer`

### Created
- `src/lib/render-segments.ts` — pure ffmpeg arg builders (refactor + new overlay branch)
- `src/lib/__tests__/render-segments.test.ts`
- `src/lib/matting/browser-support.ts` — feature detection helper
- `src/lib/matting/__tests__/browser-support.test.ts`
- `src/lib/matting/section-key.ts` — `${startMs}-${endMs}` stable key helper
- `src/lib/matting/__tests__/section-key.test.ts`
- `src/workers/matting-worker.ts` — Web Worker: demux → segment → encode → mux
- `src/components/editor/dialogs/matting-progress-modal.tsx`
- `src/components/editor/toolbar/talking-head-pills.tsx` — new 2-pill component
- `tests/e2e/matting-smoke.spec.ts` — Playwright fixture smoke test

---

## Phase 1 — Foundation (pure logic, no UI, no worker)

### Task 1: Add `kind` and matting fields to `TalkingHeadLayer`

**Files:**
- Modify: `src/lib/talking-head/talking-head-types.ts`

- [ ] **Step 1: Extend the type**

Replace the existing `TalkingHeadLayer` interface in `src/lib/talking-head/talking-head-types.ts`:

```ts
// src/lib/talking-head/talking-head-types.ts

export const TH_LAYER_FILE_ID_PREFIX = "__th_layer__";
export const TH_MATTED_FILE_ID_PREFIX = "__th_matted__";

export type TalkingHeadKind = "full" | "overlay";
export type MattingStatus = "processing" | "ready" | "failed";

export interface MattingProgress {
  framesDone: number;
  totalFrames: number;
}

/** One talking-head source: a video file paired with a script tag.
 *  Files (original and, for overlay layers, the matted webm) live in BuildState. */
export interface TalkingHeadLayer {
  /** Stable id (uuid). */
  id: string;
  /** Script tag this layer claims — for fixed layers this is always
   *  'talking-head-full' or 'talking-head-overlay' (lowercase). */
  tag: string;
  /** Synthetic file id used in MatchedClip.fileId and the multipart upload field name. */
  fileId: string;
  /** Optional human label (defaults to filename in UI). */
  label?: string;
  /** Layer kind. Defaults to 'full' for legacy records (see store.normalizeLegacyLayer). */
  kind: TalkingHeadKind;
  /** Synthetic id for the matted webm file. Only set on overlay layers when matting succeeded. */
  mattedFileId?: string;
  /** Overlay-layer matting state machine. Absent on full layers. */
  mattingStatus?: MattingStatus;
  /** Overlay-layer matting progress while `mattingStatus === 'processing'`. */
  mattingProgress?: MattingProgress;
}

export function makeLayerFileId(layerId: string): string {
  return `${TH_LAYER_FILE_ID_PREFIX}${layerId}`;
}

export function isLayerFileId(fileId: string): boolean {
  return fileId.startsWith(TH_LAYER_FILE_ID_PREFIX);
}

export function makeMattedFileId(layerId: string): string {
  return `${TH_MATTED_FILE_ID_PREFIX}${layerId}`;
}

export function isMattedFileId(fileId: string): boolean {
  return fileId.startsWith(TH_MATTED_FILE_ID_PREFIX);
}

export const FULL_LAYER_TAG = "talking-head-full";
export const OVERLAY_LAYER_TAG = "talking-head-overlay";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: errors in `talking-head-store.ts` and call sites that create layers without `kind`. These are addressed in Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/lib/talking-head/talking-head-types.ts
git commit -m "feat(talking-head): add kind + matting fields to TalkingHeadLayer type"
```

---

### Task 2: Kind-aware store helpers + invariants

**Files:**
- Modify: `src/lib/talking-head/talking-head-store.ts`
- Test: `src/lib/talking-head/__tests__/talking-head-store.test.ts`

- [ ] **Step 1: Write failing tests for kind-aware store**

Add to `src/lib/talking-head/__tests__/talking-head-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addOrReplaceLayer,
  getLayerByKind,
  removeLayer,
  setMattingStatus,
  setMattingProgress,
} from "../talking-head-store";
import {
  FULL_LAYER_TAG,
  OVERLAY_LAYER_TAG,
  type TalkingHeadLayer,
} from "../talking-head-types";

function fakeFile(name = "x.mp4"): File {
  return new File([new Uint8Array([0])], name, { type: "video/mp4" });
}

describe("addOrReplaceLayer (kind-aware)", () => {
  it("adds a full layer when empty", () => {
    const r = addOrReplaceLayer([], { kind: "full", file: fakeFile() });
    expect(r.layers).toHaveLength(1);
    expect(r.layers[0]!.kind).toBe("full");
    expect(r.layers[0]!.tag).toBe(FULL_LAYER_TAG);
  });

  it("replaces an existing full layer (keeping at most one)", () => {
    const first = addOrReplaceLayer([], { kind: "full", file: fakeFile("a.mp4") });
    const second = addOrReplaceLayer(first.layers, { kind: "full", file: fakeFile("b.mp4") }, first.files);
    expect(second.layers).toHaveLength(1);
    expect(second.layers[0]!.id).not.toBe(first.layers[0]!.id);
    // Old file id no longer in files map
    expect(second.files.has(first.layers[0]!.fileId)).toBe(false);
  });

  it("adds overlay layer with mattingStatus='processing'", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    expect(r.layers[0]!.kind).toBe("overlay");
    expect(r.layers[0]!.tag).toBe(OVERLAY_LAYER_TAG);
    expect(r.layers[0]!.mattingStatus).toBe("processing");
  });

  it("full and overlay coexist independently", () => {
    const r1 = addOrReplaceLayer([], { kind: "full", file: fakeFile() });
    const r2 = addOrReplaceLayer(r1.layers, { kind: "overlay", file: fakeFile() }, r1.files);
    expect(r2.layers).toHaveLength(2);
    expect(getLayerByKind(r2.layers, "full")).toBeDefined();
    expect(getLayerByKind(r2.layers, "overlay")).toBeDefined();
  });
});

describe("setMattingStatus / setMattingProgress", () => {
  it("transitions overlay layer processing → ready and clears progress", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const id = r.layers[0]!.id;
    const withProgress = setMattingProgress(r.layers, id, { framesDone: 50, totalFrames: 100 });
    expect(getLayerByKind(withProgress, "overlay")!.mattingProgress!.framesDone).toBe(50);

    const ready = setMattingStatus(withProgress, id, "ready", "matted-xyz");
    const overlay = getLayerByKind(ready, "overlay")!;
    expect(overlay.mattingStatus).toBe("ready");
    expect(overlay.mattedFileId).toBe("matted-xyz");
    expect(overlay.mattingProgress).toBeUndefined();
  });

  it("transitions to failed without setting mattedFileId", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const failed = setMattingStatus(r.layers, r.layers[0]!.id, "failed");
    expect(getLayerByKind(failed, "overlay")!.mattingStatus).toBe("failed");
    expect(getLayerByKind(failed, "overlay")!.mattedFileId).toBeUndefined();
  });
});

describe("removeLayer", () => {
  it("removes the layer and its files (both original and matted)", () => {
    const r = addOrReplaceLayer([], { kind: "overlay", file: fakeFile() });
    const ready = setMattingStatus(r.layers, r.layers[0]!.id, "ready", "matted-xyz");
    const filesWithMatted = new Map(r.files);
    filesWithMatted.set("matted-xyz", fakeFile("matted.webm"));

    const after = removeLayer(ready, r.layers[0]!.id, filesWithMatted);
    expect(after.layers).toHaveLength(0);
    expect(after.files.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/talking-head/__tests__/talking-head-store.test.ts`
Expected: FAIL with `addOrReplaceLayer is not exported` (and similar for the other new helpers).

- [ ] **Step 3: Rewrite the store helpers**

Replace `src/lib/talking-head/talking-head-store.ts` body:

```ts
import {
  FULL_LAYER_TAG,
  makeLayerFileId,
  OVERLAY_LAYER_TAG,
  type MattingProgress,
  type MattingStatus,
  type TalkingHeadKind,
  type TalkingHeadLayer,
} from "./talking-head-types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function tagForKind(kind: TalkingHeadKind): string {
  return kind === "full" ? FULL_LAYER_TAG : OVERLAY_LAYER_TAG;
}

export type StoreOk = { ok: true; layers: TalkingHeadLayer[]; files: Map<string, File> };
export type RemoveResult = { layers: TalkingHeadLayer[]; files: Map<string, File> };

/** Adds a new layer of the given kind. If one already exists with that kind,
 *  it is REPLACED — both the layer record and any files (original mp4 +
 *  matted webm) belonging to the old one are removed. */
export function addOrReplaceLayer(
  layers: TalkingHeadLayer[],
  args: { kind: TalkingHeadKind; file: File; label?: string },
  filesArg?: Map<string, File>,
): StoreOk {
  // Drop any existing layer of the same kind.
  const existing = layers.find((l) => l.kind === args.kind);
  const remainingLayers = existing ? layers.filter((l) => l.id !== existing.id) : layers;
  const files = new Map(filesArg);
  if (existing) {
    files.delete(existing.fileId);
    if (existing.mattedFileId) files.delete(existing.mattedFileId);
  }

  const id = newId();
  const fileId = makeLayerFileId(id);
  const layer: TalkingHeadLayer = {
    id,
    tag: tagForKind(args.kind),
    fileId,
    kind: args.kind,
    ...(args.label ? { label: args.label } : {}),
    ...(args.kind === "overlay" ? { mattingStatus: "processing" as MattingStatus } : {}),
  };
  files.set(fileId, args.file);
  return { ok: true, layers: [...remainingLayers, layer], files };
}

export function getLayerByKind(
  layers: TalkingHeadLayer[],
  kind: TalkingHeadKind,
): TalkingHeadLayer | undefined {
  return layers.find((l) => l.kind === kind);
}

export function findLayerByTag(
  layers: TalkingHeadLayer[],
  tag: string,
): TalkingHeadLayer | undefined {
  const k = tag.trim().toLowerCase();
  return layers.find((l) => l.tag === k);
}

export function removeLayer(
  layers: TalkingHeadLayer[],
  id: string,
  filesArg?: Map<string, File>,
): RemoveResult {
  const target = layers.find((l) => l.id === id);
  const files = new Map(filesArg);
  if (target) {
    files.delete(target.fileId);
    if (target.mattedFileId) files.delete(target.mattedFileId);
  }
  return {
    layers: layers.filter((l) => l.id !== id),
    files,
  };
}

export function setMattingStatus(
  layers: TalkingHeadLayer[],
  id: string,
  status: MattingStatus,
  mattedFileId?: string,
): TalkingHeadLayer[] {
  return layers.map((l) => {
    if (l.id !== id) return l;
    const next: TalkingHeadLayer = { ...l, mattingStatus: status };
    if (status === "ready" && mattedFileId) next.mattedFileId = mattedFileId;
    if (status !== "processing") delete next.mattingProgress;
    return next;
  });
}

export function setMattingProgress(
  layers: TalkingHeadLayer[],
  id: string,
  progress: MattingProgress,
): TalkingHeadLayer[] {
  return layers.map((l) => (l.id === id ? { ...l, mattingProgress: progress } : l));
}

/** Backfills `kind: 'full'` on any layer read from older IDB records that
 *  pre-date the kind field. Idempotent. */
export function normalizeLegacyLayer(layer: TalkingHeadLayer & { kind?: TalkingHeadKind }): TalkingHeadLayer {
  if (layer.kind) return layer;
  return { ...layer, kind: "full", tag: FULL_LAYER_TAG };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/talking-head/__tests__/talking-head-store.test.ts`
Expected: PASS for all new tests. (Legacy tests against the old `addLayer` API will fail — fix in step 5.)

- [ ] **Step 5: Update legacy store tests for the new API**

The existing tests use `addLayer({ tag, file })`. Update each call site to use `addOrReplaceLayer({ kind: 'full', file })`. Where tests asserted `'duplicate-tag'` error, remove the assertion (no longer possible — replace is allowed). Where tests asserted `'empty-tag'`, remove (kind enum makes empty impossible).

Run: `pnpm vitest run src/lib/talking-head/__tests__/talking-head-store.test.ts`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/talking-head/
git commit -m "feat(talking-head): kind-aware store with single-layer-per-kind invariant"
```

---

### Task 3: Script parser — multi-tag support

**Files:**
- Modify: `src/lib/script-parser.ts`
- Test: `src/lib/__tests__/script-parser.test.ts`

- [ ] **Step 1: Write failing tests for multi-tag**

Add to `src/lib/__tests__/script-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseScript } from "../script-parser";

const folders = new Set(["mower", "hook"]);

describe("multi-tag parsing", () => {
  it("parses a single tag into a one-element tags array", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower", folders);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]!.tags).toEqual(["mower"]);
  });

  it("parses `tag1, tag2` (comma + space)", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower, talking-head-overlay", folders);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]!.tags).toEqual(["mower", "talking-head-overlay"]);
  });

  it("tolerates extra whitespace (`mower ,  talking-head-overlay`)", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower ,  talking-head-overlay", folders);
    expect(r.errors).toEqual([]);
    expect(r.sections[0]!.tags).toEqual(["mower", "talking-head-overlay"]);
  });

  it("errors on 3+ tags", () => {
    const r = parseScript("00:00 --> 00:05 || hi || a, b, c", folders);
    expect(r.errors[0]!.message).toMatch(/max 2 tags/);
  });

  it("errors on two base tags", () => {
    const r = parseScript("00:00 --> 00:05 || hi || mower, hook", folders);
    expect(r.errors[0]!.message).toMatch(/only one base tag allowed/);
  });

  it("errors on duplicate overlay tag", () => {
    const r = parseScript(
      "00:00 --> 00:05 || hi || talking-head-overlay, talking-head-overlay",
      folders,
    );
    expect(r.errors[0]!.message).toMatch(/duplicate.*talking-head-overlay/i);
  });

  it("warns on legacy `talking-head` tag and suggests `talking-head-full`", () => {
    const r = parseScript("00:00 --> 00:05 || hi || talking-head", folders);
    expect(r.warnings.some((w) => /talking-head-full/.test(w.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/script-parser.test.ts`
Expected: FAIL — `tags` property missing on `ParsedSection`.

- [ ] **Step 3: Update parser to emit `tags` and validate**

In `src/lib/script-parser.ts`:

1. Change the `ParsedSection` interface:

```ts
export interface ParsedSection {
  lineNumber: number;
  startTime: number;
  endTime: number;
  tags: string[];           // CHANGED from `tag: string`
  scriptText: string;
  durationMs: number;
}
```

2. Add constants near the top of the file:

```ts
export const OVERLAY_TAG = "talking-head-overlay";
export const FULL_TAG = "talking-head-full";
export const LEGACY_FULL_TAG = "talking-head";
```

3. After the regex match in the per-line loop, replace the tag-handling block:

```ts
const rawTags = tag.split(",").map((t) => t.trim()).filter((t) => t.length > 0);

if (rawTags.length > 2) {
  errors.push({
    line: lineNumber,
    message: `Line ${lineNumber}: max 2 tags per section (got ${rawTags.length})`,
  });
  return;
}

const overlayCount = rawTags.filter((t) => t === OVERLAY_TAG).length;
if (overlayCount > 1) {
  errors.push({
    line: lineNumber,
    message: `Line ${lineNumber}: duplicate '${OVERLAY_TAG}' tag`,
  });
  return;
}
const baseTags = rawTags.filter((t) => t !== OVERLAY_TAG);
if (baseTags.length > 1) {
  errors.push({
    line: lineNumber,
    message: `Line ${lineNumber}: only one base tag allowed (got ${baseTags.map((t) => `'${t}'`).join(", ")})`,
  });
  return;
}

if (rawTags.includes(LEGACY_FULL_TAG)) {
  warnings.push({
    line: lineNumber,
    message: `Line ${lineNumber}: tag '${LEGACY_FULL_TAG}' has been renamed to '${FULL_TAG}'`,
  });
}
```

4. When pushing into `sections`, set `tags: rawTags` instead of `tag`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/__tests__/script-parser.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Run typecheck — every consumer of `.tag` now errors**

Run: `pnpm typecheck`
Expected: errors in `auto-match.ts`, `lock-preserve.ts`, UI section list, etc.

- [ ] **Step 6: Mechanical migration of consumers**

For every error reading `.tag` on a `ParsedSection`, replace with `.tags[0]` (or refactor to iterate `.tags`). Auto-match will get a proper rewrite in Task 5 — for now just compile-fix it with `.tags[0] ?? ""` to keep tests green. Mark these spots with a `// TODO(overlay): handle multi-tag` comment so Task 5 finds them.

- [ ] **Step 7: Run all tests + typecheck**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/script-parser.ts src/lib/__tests__/script-parser.test.ts src/lib/auto-match.ts src/lib/lock-preserve.ts src/components
git commit -m "feat(script-parser): support up to 2 comma-separated tags (1 base + 0/1 overlay)"
```

---

### Task 4: Section-key helper + `disabledOverlayShots` state

**Files:**
- Create: `src/lib/matting/section-key.ts`
- Create: `src/lib/matting/__tests__/section-key.test.ts`
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Write failing test for section-key helper**

Create `src/lib/matting/__tests__/section-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sectionKey, pruneStaleKeys } from "../section-key";

describe("sectionKey", () => {
  it("is stable across reorders, derived from startMs and endMs", () => {
    expect(sectionKey({ startMs: 30000, endMs: 45000 })).toBe("30000-45000");
  });
});

describe("pruneStaleKeys", () => {
  it("keeps only keys that still match a parsed section", () => {
    const live = new Set(["30000-45000", "60000-75000"]);
    const result = pruneStaleKeys(live, [
      { startMs: 30000, endMs: 45000 },
      { startMs: 100000, endMs: 110000 },
    ]);
    expect(result).toEqual(new Set(["30000-45000"]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/matting/__tests__/section-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement section-key helper**

Create `src/lib/matting/section-key.ts`:

```ts
export interface SectionRange {
  startMs: number;
  endMs: number;
}

export function sectionKey(s: SectionRange): string {
  return `${s.startMs}-${s.endMs}`;
}

export function pruneStaleKeys(
  disabled: Set<string>,
  liveSections: SectionRange[],
): Set<string> {
  const live = new Set(liveSections.map(sectionKey));
  const out = new Set<string>();
  for (const k of disabled) if (live.has(k)) out.add(k);
  return out;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm vitest run src/lib/matting/__tests__/section-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `disabledOverlayShots` to BuildState**

In `src/components/build/build-state-context.tsx`:

1. Add to `BuildState` interface near the other layer state:

```ts
disabledOverlayShots: Set<string>;
disableOverlayShot: (key: string) => void;
restoreOverlayShot: (key: string) => void;
```

2. Add a `useState<Set<string>>(new Set())` in the provider, plus the two callbacks:

```ts
const [disabledOverlayShots, setDisabledOverlayShots] = useState<Set<string>>(new Set());

const disableOverlayShot = useCallback((key: string) => {
  setDisabledOverlayShots((prev) => new Set(prev).add(key));
}, []);

const restoreOverlayShot = useCallback((key: string) => {
  setDisabledOverlayShots((prev) => {
    const next = new Set(prev);
    next.delete(key);
    return next;
  });
}, []);
```

3. Wire `pruneStaleKeys` into the script-parse effect — after parsing succeeds and produces `sections`, call:

```ts
setDisabledOverlayShots((prev) => pruneStaleKeys(prev, sections));
```

4. Expose `disabledOverlayShots`, `disableOverlayShot`, `restoreOverlayShot` in the context value.

- [ ] **Step 6: Run typecheck + tests**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/matting/ src/components/build/build-state-context.tsx
git commit -m "feat(overlay): disabledOverlayShots state + stable section key helper"
```

---

### Task 5: Auto-match — read `tags[]`, emit `overlayClip`

**Files:**
- Modify: `src/lib/auto-match.ts`
- Test: `src/lib/__tests__/auto-match.test.ts`

- [ ] **Step 1: Write failing tests for overlay auto-match**

Add to `src/lib/__tests__/auto-match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchSections } from "../auto-match";
import { FULL_LAYER_TAG, OVERLAY_LAYER_TAG, type TalkingHeadLayer } from "../talking-head/talking-head-types";

function fakeFullLayer(): TalkingHeadLayer {
  return { id: "full-1", tag: FULL_LAYER_TAG, fileId: "f-full", kind: "full" };
}
function fakeOverlayLayer(opts: { status?: "processing" | "ready"; mattedFileId?: string } = {}): TalkingHeadLayer {
  return {
    id: "ov-1",
    tag: OVERLAY_LAYER_TAG,
    fileId: "f-overlay",
    kind: "overlay",
    mattingStatus: opts.status ?? "ready",
    ...(opts.mattedFileId ? { mattedFileId: opts.mattedFileId } : { mattedFileId: "matted-ov-1" }),
  };
}

const noClips = new Map();

describe("matchSections — overlay", () => {
  it("emits overlayClip when section has overlay tag and overlay layer is ready", () => {
    const sections = [{
      lineNumber: 1, startTime: 30, endTime: 45,
      tags: ["mower", OVERLAY_LAYER_TAG], scriptText: "x", durationMs: 15000,
    }];
    const out = matchSections(sections, noClips, [fakeOverlayLayer()], new Set());
    expect(out[0]!.overlayClip).toBeDefined();
    expect(out[0]!.overlayClip!.sourceSeekMs).toBe(30000);
    expect(out[0]!.overlayClip!.fileId).toBe("matted-ov-1");
    expect(out[0]!.overlayClip!.isOverlay).toBe(true);
  });

  it("warns and omits overlayClip when overlay layer is processing", () => {
    const sections = [{
      lineNumber: 1, startTime: 30, endTime: 45,
      tags: ["mower", OVERLAY_LAYER_TAG], scriptText: "x", durationMs: 15000,
    }];
    const out = matchSections(sections, noClips, [fakeOverlayLayer({ status: "processing" })], new Set());
    expect(out[0]!.overlayClip).toBeUndefined();
    expect(out[0]!.warnings.some((w) => /overlay.*not ready/i.test(w))).toBe(true);
  });

  it("skips overlay when section key is in disabledOverlayShots", () => {
    const sections = [{
      lineNumber: 1, startTime: 30, endTime: 45,
      tags: ["mower", OVERLAY_LAYER_TAG], scriptText: "x", durationMs: 15000,
    }];
    const out = matchSections(sections, noClips, [fakeOverlayLayer()], new Set(["30000-45000"]));
    expect(out[0]!.overlayClip).toBeUndefined();
    expect(out[0]!.warnings).toEqual([]);
  });

  it("base = talking-head-full + overlay both emit", () => {
    const sections = [{
      lineNumber: 1, startTime: 30, endTime: 45,
      tags: [FULL_LAYER_TAG, OVERLAY_LAYER_TAG], scriptText: "x", durationMs: 15000,
    }];
    const out = matchSections(sections, noClips, [fakeFullLayer(), fakeOverlayLayer()], new Set());
    expect(out[0]!.clips[0]!.fileId).toBe("f-full");          // base = full TH slice
    expect(out[0]!.clips[0]!.sourceSeekMs).toBe(30000);
    expect(out[0]!.overlayClip).toBeDefined();
    expect(out[0]!.overlayClip!.fileId).toBe("matted-ov-1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: FAIL — `overlayClip` field missing, `matchSections` signature mismatch.

- [ ] **Step 3: Update auto-match**

In `src/lib/auto-match.ts`:

1. Extend types:

```ts
export interface MatchedClip {
  clipId: string;
  fileId: string;
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
  sourceSeekMs?: number;
  isOverlay?: boolean;       // NEW
}

export interface MatchedSection {
  sectionIndex: number;
  tag: string;               // first base tag, kept for back-compat UI labels
  startMs: number;
  endMs: number;
  durationMs: number;
  clips: MatchedClip[];
  overlayClip?: MatchedClip;  // NEW
  warnings: string[];
  userLocked?: boolean;
}
```

2. Update `matchSections` signature to take `disabledOverlayShots: Set<string>`:

```ts
export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  talkingHeadLayers: TalkingHeadLayer[] = [],
  disabledOverlayShots: Set<string> = new Set(),
): MatchedSection[] { /* ... */ }
```

3. Inside the per-section loop:

```ts
import { OVERLAY_TAG } from "./script-parser";
import { sectionKey } from "./matting/section-key";

// ...
const baseTag = (section.tags.find((t) => t !== OVERLAY_TAG) ?? "").toLowerCase();
const hasOverlay = section.tags.includes(OVERLAY_TAG);

// Existing base-resolution logic, but using `baseTag` in place of `section.tag.toLowerCase()`.
// Keep the existing "TH layer wins over b-roll folder" precedence.

// After building baseClips + warnings, attach overlayClip if applicable:
let overlayClip: MatchedClip | undefined;
if (hasOverlay) {
  const overlayLayer = talkingHeadLayers.find((l) => l.kind === "overlay");
  const key = sectionKey({ startMs, endMs });
  const isDisabled = disabledOverlayShots.has(key);

  if (isDisabled) {
    // intentionally silent — user disabled this shot
  } else if (!overlayLayer || overlayLayer.mattingStatus !== "ready" || !overlayLayer.mattedFileId) {
    warnings.push(`Overlay layer not ready — section ${sectionIndex + 1} rendered without overlay`);
  } else {
    overlayClip = {
      clipId: "talking-head-overlay",
      fileId: overlayLayer.mattedFileId,
      speedFactor: 1,
      trimDurationMs: section.durationMs,
      sourceSeekMs: startMs,
      isPlaceholder: false,
      isOverlay: true,
    };
  }
}

return {
  sectionIndex,
  tag: baseTag,          // first base tag for back-compat UI labels
  startMs,
  endMs,
  durationMs: section.durationMs,
  clips,
  ...(overlayClip ? { overlayClip } : {}),
  warnings,
};
```

4. Update all callers of `matchSections` to pass `disabledOverlayShots` (in `build-state-context.tsx`).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/lib/__tests__/auto-match.test.ts`
Expected: ALL PASS (new overlay tests + existing tests still green).

- [ ] **Step 5: Remove the TODO comments from Task 3**

Search for `// TODO(overlay):` comments left by Task 3 and remove them — Task 5 has handled them.

- [ ] **Step 6: Run full test suite + typecheck**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts src/components/build/build-state-context.tsx
git commit -m "feat(auto-match): emit overlayClip for sections with talking-head-overlay tag"
```

---

## Phase 2 — Render Layer

### Task 6: Extract pure ffmpeg arg builders (`render-segments.ts`)

**Files:**
- Create: `src/lib/render-segments.ts`
- Create: `src/lib/__tests__/render-segments.test.ts`
- Modify: `src/app/api/render/route.ts`

- [ ] **Step 1: Write tests for the extracted pure builders**

Create `src/lib/__tests__/render-segments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildBaseSegmentArgs,
  buildBlackGapArgs,
  buildOverlayMergeArgs,
  OVERLAY_PADDING_PX,
  OVERLAY_WIDTH_RATIO,
} from "../render-segments";

describe("buildBlackGapArgs", () => {
  it("produces a 1080x1920 black segment of the requested duration", () => {
    const args = buildBlackGapArgs({
      outputWidth: 1080,
      outputHeight: 1920,
      durationMs: 2000,
      outPath: "/tmp/gap.ts",
    });
    expect(args).toContain("-i");
    expect(args.join(" ")).toMatch(/color=c=black:s=1080x1920:r=30:d=2/);
    expect(args).toContain("/tmp/gap.ts");
  });
});

describe("buildBaseSegmentArgs — talking-head slice", () => {
  it("uses input-seek and trims to section duration", () => {
    const args = buildBaseSegmentArgs({
      kind: "talking-head",
      inputPath: "/tmp/in.mp4",
      sourceSeekMs: 30000,
      trimDurationMs: 15000,
      outputWidth: 1080,
      outputHeight: 1920,
      outPath: "/tmp/seg.ts",
    });
    const joined = args.join(" ");
    expect(joined).toMatch(/-ss 30(?:\.0+)?/);
    expect(joined).toMatch(/-t 15(?:\.0+)?/);
  });
});

describe("buildOverlayMergeArgs", () => {
  it("scales overlay to 30% width and positions bottom-right with 24px padding", () => {
    const args = buildOverlayMergeArgs({
      basePath: "/tmp/base.mp4",
      overlayPath: "/tmp/matted.webm",
      sourceSeekMs: 30000,
      trimDurationMs: 15000,
      outputWidth: 1080,
      outputHeight: 1920,
      outPath: "/tmp/merged.ts",
    });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toMatch(new RegExp(`scale=iw\\*${OVERLAY_WIDTH_RATIO.toString().replace(".", "\\.")}`));
    expect(filter).toMatch(new RegExp(`overlay=W-overlay_w-${OVERLAY_PADDING_PX}:H-overlay_h-${OVERLAY_PADDING_PX}`));
    expect(filter).toMatch(/shortest=1/);
    expect(args.join(" ")).toMatch(/-ss 30/);
    expect(args.join(" ")).toMatch(/-t 15/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/render-segments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `render-segments.ts`**

Create `src/lib/render-segments.ts`:

```ts
export const FPS = 30;
export const OVERLAY_WIDTH_RATIO = 0.3;
export const OVERLAY_PADDING_PX = 24;
export const OVERLAY_ANCHOR: "bottom-right" = "bottom-right";

type Common = { outputWidth: number; outputHeight: number; outPath: string };

export function buildBlackGapArgs(
  args: { durationMs: number } & Common,
): string[] {
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=black:s=${args.outputWidth}x${args.outputHeight}:r=${FPS}:d=${args.durationMs / 1000}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-f", "mpegts",
    args.outPath,
  ];
}

interface BaseTalkingHead {
  kind: "talking-head";
  inputPath: string;
  sourceSeekMs: number;
  trimDurationMs: number;
}
interface BaseBroll {
  kind: "broll";
  inputPath: string;
  trimDurationMs?: number;
  speedFactor: number;
}
interface BasePlaceholder {
  kind: "placeholder";
  durationMs: number;
}

export function buildBaseSegmentArgs(
  args: (BaseTalkingHead | BaseBroll | BasePlaceholder) & Common,
): string[] {
  const { outputWidth: W, outputHeight: H, outPath } = args;
  const scaleAndPad =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;

  if (args.kind === "placeholder") {
    return buildBlackGapArgs({ durationMs: args.durationMs, outputWidth: W, outputHeight: H, outPath });
  }

  if (args.kind === "talking-head") {
    return [
      "-y",
      "-ss", String(args.sourceSeekMs / 1000),
      "-i", args.inputPath,
      "-t", String(args.trimDurationMs / 1000),
      "-vf", `${scaleAndPad},setpts=PTS-STARTPTS`,
      "-an",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode",
      "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-f", "mpegts",
      outPath,
    ];
  }

  // b-roll
  return [
    "-y",
    "-i", args.inputPath,
    ...(args.trimDurationMs ? ["-t", String(args.trimDurationMs / 1000)] : []),
    "-vf", `${scaleAndPad},setpts=${(1 / args.speedFactor).toFixed(4)}*PTS`,
    "-an",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-f", "mpegts",
    outPath,
  ];
}

export function buildOverlayMergeArgs(args: {
  basePath: string;
  overlayPath: string;
  sourceSeekMs: number;
  trimDurationMs: number;
} & Common): string[] {
  const { outputWidth: _W, outputHeight: _H, outPath } = args;
  const filter =
    `[1:v]scale=iw*${OVERLAY_WIDTH_RATIO}:-2,setpts=PTS-STARTPTS[fg];` +
    `[0:v][fg]overlay=W-overlay_w-${OVERLAY_PADDING_PX}:H-overlay_h-${OVERLAY_PADDING_PX}:shortest=1[v]`;
  return [
    "-y",
    "-i", args.basePath,
    "-ss", String(args.sourceSeekMs / 1000),
    "-i", args.overlayPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-t", String(args.trimDurationMs / 1000),
    "-an",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-f", "mpegts",
    outPath,
  ];
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm vitest run src/lib/__tests__/render-segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `route.ts` to use the pure builders**

In `src/app/api/render/route.ts`:

- Import `buildBaseSegmentArgs`, `buildBlackGapArgs`, `FPS` from `@/lib/render-segments`.
- Delete the inline `encodeBlackSegment` function and the per-section ffmpeg arg blocks — replace each with a call to the appropriate builder + `runFFmpeg(builder(...))`.
- Keep the `FPS` constant import from `render-segments` (delete the local `const FPS = 30`).

Diff sketch (for the talking-head branch):

```ts
// Before: inline 18-line ffmpeg arg array
// After:
await runFFmpeg(buildBaseSegmentArgs({
  kind: "talking-head",
  inputPath,
  sourceSeekMs: matched.sourceSeekMs!,
  trimDurationMs: matched.trimDurationMs ?? section.durationMs,
  outputWidth,
  outputHeight,
  outPath: segPath,
}));
```

Do the same for the b-roll and placeholder branches, and for `encodeBlackSegment` callers.

- [ ] **Step 6: Verify route still works**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

Sanity-check manually: run the dev server, render a small project, verify output mp4 unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/render-segments.ts src/lib/__tests__/render-segments.test.ts src/app/api/render/route.ts
git commit -m "refactor(render): extract pure ffmpeg arg builders into render-segments module"
```

---

### Task 7: Render route — overlay branch + `matted-clips` field

**Files:**
- Modify: `src/app/api/render/route.ts`

- [ ] **Step 1: Accept `matted-clips` multipart files**

After the existing `clips` field iteration in `POST`:

```ts
const mattedByFileId = new Map<string, string>();
for (const entry of formData.getAll("matted-clips")) {
  if (!(entry instanceof File)) continue;
  const safeName = entry.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const p = path.join(workDir, `matted-${safeName}.webm`);
  await writeFile(p, Buffer.from(await entry.arrayBuffer()));
  mattedByFileId.set(entry.name, p);
}
```

- [ ] **Step 2: Branch the per-section encode for overlay**

Inside the per-section loop, AFTER each base segment has been encoded to `seg-${i}-${j}.ts`, check for an overlay clip on the *section* (not the per-clip iteration):

```ts
if (section.overlayClip) {
  const overlayPath = mattedByFileId.get(section.overlayClip.fileId);
  if (overlayPath) {
    // Re-encode the *whole section's* base output (concat its segments first if multiple)
    // into a single intermediate MP4, then overlay-merge it.
    const baseConcatList = path.join(workDir, `base-list-${i}.txt`);
    const baseSegs = /* the seg paths produced for this section in this iteration */;
    await writeFile(baseConcatList, baseSegs.map((p) => `file '${p}'`).join("\n"));
    const baseMp4 = path.join(workDir, `base-${i}.mp4`);
    await runFFmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", baseConcatList,
      "-c", "copy", baseMp4,
    ]);

    const mergedPath = path.join(workDir, `seg-${i}-merged.ts`);
    await runFFmpeg(buildOverlayMergeArgs({
      basePath: baseMp4,
      overlayPath,
      sourceSeekMs: section.overlayClip.sourceSeekMs!,
      trimDurationMs: section.overlayClip.trimDurationMs!,
      outputWidth, outputHeight,
      outPath: mergedPath,
    }));

    // Replace the section's base segments with the merged one in the segments[] list.
    for (const baseSeg of baseSegs) {
      const idx = segments.indexOf(baseSeg);
      if (idx >= 0) segments.splice(idx, 1);
    }
    segments.push(mergedPath);
  }
}
```

Implementation note: keep a running `currentSectionSegments: string[]` accumulator inside the loop so the overlay branch knows exactly which seg paths belong to the current section. Append to it inside the per-clip loop and reset when the section changes.

- [ ] **Step 3: Smoke-test with a fixture**

Manually craft a multipart `POST` with one 5s base clip + one 5s matted webm + a timeline JSON that has `overlayClip` for the single section. Verify the output mp4 plays and shows a cutout in the bottom-right corner.

(Make this a Playwright test in Task 23 — for now just curl it.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/render/route.ts
git commit -m "feat(render): overlay branch — composite matted webm onto base segment per section"
```

---

## Phase 3 — IDB v3 + matted-files storage

### Task 8: IDB upgrade to v3 with `matted-files` store

**Files:**
- Modify: `src/lib/media-storage.ts`
- Test: `src/lib/__tests__/media-storage.test.ts`

- [ ] **Step 1: Write failing tests for `matted-files` helpers**

Add to `src/lib/__tests__/media-storage.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { openMediaDB, deleteMediaDB, putMattedFile, getMattedFile, deleteMattedFile } from "../media-storage";

beforeEach(async () => { await deleteMediaDB(); });

describe("matted-files store (v3)", () => {
  it("round-trips a matted webm blob", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" });
    await putMattedFile({ id: "matted-1", blob, filename: "matted-1.webm" });
    const got = await getMattedFile("matted-1");
    expect(got).toBeDefined();
    expect(got!.filename).toBe("matted-1.webm");
    expect(await got!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  it("delete is idempotent on missing id", async () => {
    await expect(deleteMattedFile("nope")).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/__tests__/media-storage.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Bump DB version + add store + helpers**

In `src/lib/media-storage.ts`:

```ts
const DB_VERSION = 3;        // was 2

export interface MattedFileRecord {
  id: string;
  blob: Blob;
  filename: string;
}

// Inside upgrade():
if (oldVersion < 3 && !db.objectStoreNames.contains("matted-files")) {
  db.createObjectStore("matted-files", { keyPath: "id" });
}

export async function putMattedFile(rec: MattedFileRecord): Promise<void> {
  const db = await openMediaDB();
  await db.put("matted-files", rec);
}

export async function getMattedFile(id: string): Promise<MattedFileRecord | undefined> {
  const db = await openMediaDB();
  return db.get("matted-files", id);
}

export async function deleteMattedFile(id: string): Promise<void> {
  const db = await openMediaDB();
  await db.delete("matted-files", id);
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm vitest run src/lib/__tests__/media-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-storage.ts src/lib/__tests__/media-storage.test.ts
git commit -m "feat(idb): v3 — add matted-files object store + put/get/delete helpers"
```

---

## Phase 4 — Matting worker (HIGH RISK)

### Task 9: Browser support detection

**Files:**
- Create: `src/lib/matting/browser-support.ts`
- Create: `src/lib/matting/__tests__/browser-support.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/matting/__tests__/browser-support.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canMatte } from "../browser-support";

describe("canMatte", () => {
  it("returns false when VideoEncoder is missing", () => {
    expect(canMatte({ hasVideoEncoder: false, isMobile: false })).toEqual({ ok: false, reason: "no-webcodecs" });
  });
  it("returns false on mobile chromium", () => {
    expect(canMatte({ hasVideoEncoder: true, isMobile: true })).toEqual({ ok: false, reason: "mobile-not-supported" });
  });
  it("returns ok when both present and desktop", () => {
    expect(canMatte({ hasVideoEncoder: true, isMobile: false })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Implement**

Create `src/lib/matting/browser-support.ts`:

```ts
export type SupportResult =
  | { ok: true }
  | { ok: false; reason: "no-webcodecs" | "mobile-not-supported" };

export function canMatte(env: { hasVideoEncoder: boolean; isMobile: boolean }): SupportResult {
  if (!env.hasVideoEncoder) return { ok: false, reason: "no-webcodecs" };
  if (env.isMobile) return { ok: false, reason: "mobile-not-supported" };
  return { ok: true };
}

export function detectMattingSupport(): SupportResult {
  if (typeof window === "undefined") return { ok: false, reason: "no-webcodecs" };
  const hasVideoEncoder = typeof (globalThis as any).VideoEncoder === "function";
  const isMobile = /Android|Mobile|iPhone|iPad/i.test(navigator.userAgent);
  return canMatte({ hasVideoEncoder, isMobile });
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm vitest run src/lib/matting/__tests__/browser-support.test.ts
git add src/lib/matting/browser-support.ts src/lib/matting/__tests__/browser-support.test.ts
git commit -m "feat(matting): browser-support detection (WebCodecs + non-mobile)"
```

---

### Task 10: Install matting deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm add @mediapipe/tasks-vision mp4box webm-muxer
```

These are runtime deps (worker imports them). No `-D` flag.

- [ ] **Step 2: Verify install + lockfile updated**

Run: `pnpm install && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add MediaPipe tasks-vision, mp4box, webm-muxer for browser matting"
```

---

### Task 11: Matting worker scaffold

**Files:**
- Create: `src/workers/matting-worker.ts`

This task is the highest-risk single block. Write it once, then iterate live with the smoke test in Task 12.

- [ ] **Step 1: Implement the worker**

Create `src/workers/matting-worker.ts`:

```ts
// src/workers/matting-worker.ts
//
// Decode mp4 -> per-frame selfie segmentation -> I420A frame -> VP9 alpha encode -> WebM mux.
// Posts progress + final blob back to the main thread.
//
// Risks acknowledged in the spec: mp4 demux edge cases (B-frames), I420A plane alignment,
// webm-muxer alpha track configuration. If any of these blow up during the smoke test in
// Task 12, pause and revisit before continuing UI work.

import { Muxer, ArrayBufferTarget } from "webm-muxer";
import MP4Box, { MP4ArrayBuffer } from "mp4box";
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

type Inbound = { type: "start"; sourceBlob: Blob; mattedFileId: string } | { type: "abort" };
type Outbound =
  | { type: "progress"; framesDone: number; totalFrames: number }
  | { type: "done"; mattedBlob: Blob }
  | { type: "failed"; message: string };

let aborted = false;

self.addEventListener("message", async (ev: MessageEvent<Inbound>) => {
  const msg = ev.data;
  if (msg.type === "abort") { aborted = true; return; }
  if (msg.type !== "start") return;
  try {
    const blob = await runMatting(msg.sourceBlob);
    if (!aborted) post({ type: "done", mattedBlob: blob });
  } catch (e: unknown) {
    post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
  }
});

function post(m: Outbound) { (self as unknown as Worker).postMessage(m); }

async function runMatting(sourceBlob: Blob): Promise<Blob> {
  // 1. Load MediaPipe selfie segmenter.
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  );
  const segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
    runningMode: "VIDEO",
  });

  // 2. Demux mp4 to get track metadata + sample stream.
  const arr = await sourceBlob.arrayBuffer() as MP4ArrayBuffer;
  arr.fileStart = 0;
  const mp4 = MP4Box.createFile();
  let totalFrames = 0;
  let width = 0;
  let height = 0;
  const decoderConfigPromise = new Promise<VideoDecoderConfig>((resolve, reject) => {
    mp4.onError = reject;
    mp4.onReady = (info) => {
      const track = info.videoTracks[0];
      if (!track) return reject(new Error("No video track in source mp4"));
      totalFrames = track.nb_samples;
      width = track.video.width;
      height = track.video.height;
      const trak = mp4.getTrackById(track.id);
      const description = buildAvcDescription(trak);
      resolve({
        codec: track.codec,
        codedWidth: width,
        codedHeight: height,
        description,
      });
      mp4.setExtractionOptions(track.id, null, { nbSamples: 100 });
      mp4.start();
    };
  });
  mp4.appendBuffer(arr);
  mp4.flush();
  const decoderConfig = await decoderConfigPromise;

  // 3. Set up decoder + encoder + muxer.
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "V_VP9",
      width,
      height,
      alpha: true,
      frameRate: 30,
    },
    type: "webm",
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({
    codec: "vp09.00.10.08",
    width,
    height,
    bitrate: 4_000_000,
    framerate: 30,
    alpha: "keep",
  });

  let framesEmitted = 0;
  const decoder = new VideoDecoder({
    output: async (frame) => {
      if (aborted) { frame.close(); return; }
      const alphaFrame = await segmentToAlphaFrame(frame, segmenter, width, height);
      frame.close();
      encoder.encode(alphaFrame, { keyFrame: framesEmitted % 30 === 0 });
      alphaFrame.close();
      framesEmitted++;
      if (framesEmitted % 30 === 0) {
        post({ type: "progress", framesDone: framesEmitted, totalFrames });
      }
    },
    error: (e) => { throw e; },
  });
  decoder.configure(decoderConfig);

  // 4. Feed samples to the decoder.
  await new Promise<void>((resolve) => {
    mp4.onSamples = (_id, _user, samples) => {
      for (const s of samples) {
        if (aborted) break;
        decoder.decode(new EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: (s.cts * 1_000_000) / s.timescale,
          duration: (s.duration * 1_000_000) / s.timescale,
          data: s.data,
        }));
      }
      if (samples.length > 0 && samples[samples.length - 1]!.number + 1 >= totalFrames) resolve();
    };
  });

  await decoder.flush();
  await encoder.flush();
  encoder.close();
  decoder.close();
  segmenter.close();
  muxer.finalize();
  const { buffer } = muxer.target;
  return new Blob([buffer], { type: "video/webm" });
}

// Build an AVC/HEVC description blob from an mp4box trak — required by VideoDecoder.configure.
function buildAvcDescription(trak: any): Uint8Array {
  // Implementation note: the canonical recipe is the avcC box from the sample entry.
  // Reference impl: https://github.com/w3c/webcodecs/blob/main/samples/video-decode-display/demuxer_mp4.js
  const stsd = trak.mdia.minf.stbl.stsd;
  const entry = stsd.entries[0];
  const box = entry.avcC ?? entry.hvcC;
  if (!box) throw new Error("Unsupported codec — only AVC/HEVC mp4 supported");
  const stream = new (globalThis as any).DataStream(undefined, 0, (globalThis as any).DataStream.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 8); // strip box header
}

// RGBA bitmap from VideoFrame -> alpha mask via segmenter -> compose I420A VideoFrame.
async function segmentToAlphaFrame(
  frame: VideoFrame,
  segmenter: ImageSegmenter,
  width: number,
  height: number,
): Promise<VideoFrame> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0);

  const mask = await new Promise<Uint8Array>((resolve) => {
    segmenter.segmentForVideo(canvas, performance.now(), (result) => {
      const cm = result.categoryMask!;
      // selfie_segmenter category 0 = background, 1 = person
      const data = cm.getAsUint8Array();
      cm.close();
      resolve(data);
    });
  });

  // Build I420A planes.
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const yPlane = new Uint8ClampedArray(width * height);
  const uPlane = new Uint8ClampedArray((width / 2) * (height / 2));
  const vPlane = new Uint8ClampedArray((width / 2) * (height / 2));
  const aPlane = new Uint8ClampedArray(width * height);
  rgbaToI420A(rgba, mask, width, height, yPlane, uPlane, vPlane, aPlane);

  const init = {
    format: "I420A" as const,
    codedWidth: width,
    codedHeight: height,
    timestamp: frame.timestamp ?? 0,
    layout: [
      { offset: 0, stride: width },
      { offset: width * height, stride: width / 2 },
      { offset: width * height + (width / 2) * (height / 2), stride: width / 2 },
      { offset: width * height + 2 * (width / 2) * (height / 2), stride: width },
    ],
  };
  const buf = new Uint8Array(
    width * height + 2 * (width / 2) * (height / 2) + width * height,
  );
  buf.set(yPlane, 0);
  buf.set(uPlane, width * height);
  buf.set(vPlane, width * height + (width / 2) * (height / 2));
  buf.set(aPlane, width * height + 2 * (width / 2) * (height / 2));
  return new VideoFrame(buf, init);
}

function rgbaToI420A(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  y: Uint8ClampedArray, u: Uint8ClampedArray, v: Uint8ClampedArray, a: Uint8ClampedArray,
) {
  // BT.601 limited range; selfie_segmenter mask is 1 for foreground, 0 for background.
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const px = (j * W + i) * 4;
      const r = rgba[px]!, g = rgba[px + 1]!, b = rgba[px + 2]!;
      y[j * W + i] = ( 0.257 * r + 0.504 * g + 0.098 * b) + 16;
      a[j * W + i] = mask[j * W + i] ? 255 : 0;
    }
  }
  for (let j = 0; j < H; j += 2) {
    for (let i = 0; i < W; i += 2) {
      const px = (j * W + i) * 4;
      const r = rgba[px]!, g = rgba[px + 1]!, b = rgba[px + 2]!;
      const uvIdx = (j / 2) * (W / 2) + (i / 2);
      u[uvIdx] = (-0.148 * r - 0.291 * g + 0.439 * b) + 128;
      v[uvIdx] = ( 0.439 * r - 0.368 * g - 0.071 * b) + 128;
    }
  }
}
```

- [ ] **Step 2: Wire Next.js to load the worker**

In the caller (Task 13 sets this up), the worker URL is constructed like:

```ts
new Worker(new URL("../../workers/matting-worker.ts", import.meta.url), { type: "module" });
```

Next.js's Webpack/Turbopack handles ESM-typed workers out of the box; no config change needed.

- [ ] **Step 3: Commit**

```bash
git add src/workers/matting-worker.ts
git commit -m "feat(matting): worker — mp4 demux + segment + VP9 alpha encode pipeline"
```

---

### Task 12: Matting smoke test (Playwright)

**Files:**
- Create: `tests/e2e/matting-smoke.spec.ts`
- Create: `tests/fixtures/talking-head-5s.mp4` (manual — record or download a 5-second face mp4)

- [ ] **Step 1: Place the fixture**

Save a 5-second 720p mp4 of a face to `tests/fixtures/talking-head-5s.mp4`. Source: record a short selfie clip, or use a clip from any open video dataset. File size should be < 5MB so it commits cleanly.

- [ ] **Step 2: Write the smoke test**

Create `tests/e2e/matting-smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("matting worker produces a webm blob with alpha pixels", async ({ page }) => {
  await page.goto("/test-pages/matting-smoke");
  await page.setInputFiles("input[type=file]", "tests/fixtures/talking-head-5s.mp4");
  await page.click("button#start");
  await expect(page.locator("#status")).toHaveText("done", { timeout: 120_000 });
  const transparent = await page.evaluate(() => (window as any).__corner_pixel_alpha);
  expect(transparent).toBeLessThan(255);   // bottom-right corner should be transparent
});
```

- [ ] **Step 3: Stub the test page**

Create `src/app/test-pages/matting-smoke/page.tsx`:

```tsx
"use client";
import { useState } from "react";

export default function MattingSmoke() {
  const [status, setStatus] = useState("idle");
  return (
    <div>
      <input type="file" accept="video/mp4" />
      <button id="start" onClick={async () => {
        const f = (document.querySelector("input[type=file]") as HTMLInputElement).files?.[0];
        if (!f) return;
        setStatus("processing");
        const w = new Worker(new URL("../../../workers/matting-worker.ts", import.meta.url), { type: "module" });
        w.onmessage = async (e) => {
          if (e.data.type === "done") {
            const url = URL.createObjectURL(e.data.mattedBlob);
            const vid = document.createElement("video"); vid.src = url; vid.muted = true; await vid.play();
            await new Promise((r) => setTimeout(r, 500));
            const c = document.createElement("canvas"); c.width = vid.videoWidth; c.height = vid.videoHeight;
            const cx = c.getContext("2d")!; cx.drawImage(vid, 0, 0);
            const p = cx.getImageData(c.width - 5, c.height - 5, 1, 1).data;
            (window as any).__corner_pixel_alpha = p[3];
            setStatus("done");
          }
          if (e.data.type === "failed") setStatus("failed: " + e.data.message);
        };
        w.postMessage({ type: "start", sourceBlob: f, mattedFileId: "smoke" });
      }}>Start</button>
      <div id="status">{status}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the smoke test**

Run: `pnpm exec playwright test tests/e2e/matting-smoke.spec.ts --headed`
Expected: PASS within 2 minutes. Alpha value < 255 on the bottom-right pixel proves background was removed.

**If FAIL** (encoder errors, decoder errors, muxer errors): this is the de-risk gate. Pause UI work, debug the worker until green. Common fixes:
- AVC description box format → check the demuxer_mp4.js reference linked in the worker comment
- I420A layout offsets → reorder Y/U/V/A or swap chroma planes
- Encoder rejects `alpha: 'keep'` → confirm Chrome ≥ 94 and the codec string is exactly `vp09.00.10.08`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/matting-smoke.spec.ts tests/fixtures/talking-head-5s.mp4 src/app/test-pages/
git commit -m "test(matting): Playwright smoke — worker produces alpha-channel webm"
```

---

### Task 13: Hook matting worker into build state

**Files:**
- Modify: `src/components/build/build-state-context.tsx`

- [ ] **Step 1: Add the matting kickoff effect**

When `addOrReplaceLayer({ kind: "overlay", ... })` runs, the layer is created with `mattingStatus: 'processing'`. Spawn a worker keyed by `layer.id`:

```ts
const mattingWorkers = useRef<Map<string, Worker>>(new Map());

const startMatting = useCallback((layer: TalkingHeadLayer, file: File) => {
  const w = new Worker(new URL("../../workers/matting-worker.ts", import.meta.url), { type: "module" });
  mattingWorkers.current.set(layer.id, w);
  w.onmessage = async (e) => {
    if (e.data.type === "progress") {
      setTalkingHeadLayers((prev) => setMattingProgress(prev, layer.id, {
        framesDone: e.data.framesDone, totalFrames: e.data.totalFrames,
      }));
    } else if (e.data.type === "done") {
      const mattedFileId = makeMattedFileId(layer.id);
      await putMattedFile({ id: mattedFileId, blob: e.data.mattedBlob, filename: `${mattedFileId}.webm` });
      setTalkingHeadLayers((prev) => setMattingStatus(prev, layer.id, "ready", mattedFileId));
      setTalkingHeadFiles((prev) => {
        const next = new Map(prev); next.set(mattedFileId, new File([e.data.mattedBlob], `${mattedFileId}.webm`, { type: "video/webm" }));
        return next;
      });
      w.terminate(); mattingWorkers.current.delete(layer.id);
    } else if (e.data.type === "failed") {
      setTalkingHeadLayers((prev) => setMattingStatus(prev, layer.id, "failed"));
      w.terminate(); mattingWorkers.current.delete(layer.id);
    }
  };
  w.postMessage({ type: "start", sourceBlob: file, mattedFileId: makeMattedFileId(layer.id) });
}, []);

const abortMatting = useCallback((layerId: string) => {
  const w = mattingWorkers.current.get(layerId);
  if (w) { w.terminate(); mattingWorkers.current.delete(layerId); }
  setTalkingHeadLayers((prev) => prev.filter((l) => l.id !== layerId));
  setTalkingHeadFiles((prev) => {
    const layer = talkingHeadLayers.find((l) => l.id === layerId);
    if (!layer) return prev;
    const next = new Map(prev); next.delete(layer.fileId);
    if (layer.mattedFileId) next.delete(layer.mattedFileId);
    return next;
  });
}, [talkingHeadLayers]);
```

- [ ] **Step 2: Update `addTalkingHeadLayer` to call `startMatting` for overlay**

```ts
const addTalkingHeadLayer = useCallback((args: { kind: TalkingHeadKind; file: File; label?: string }) => {
  const r = addOrReplaceLayer(talkingHeadLayers, args, talkingHeadFiles);
  setTalkingHeadLayers(r.layers);
  setTalkingHeadFiles(r.files);
  if (args.kind === "overlay") {
    const layer = r.layers.find((l) => l.kind === "overlay")!;
    startMatting(layer, args.file);
  }
}, [talkingHeadLayers, talkingHeadFiles, startMatting]);
```

- [ ] **Step 3: Expose new actions in the context**

Add `addTalkingHeadLayer`, `abortMatting`, `retryMatting` to the context value. (`retryMatting` calls `startMatting(layer, file)` again — file already in `talkingHeadFiles`.)

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/build/build-state-context.tsx
git commit -m "feat(matting): spawn worker on overlay layer add + progress/done/failed wiring"
```

---

## Phase 5 — UI

### Task 14: Two fixed toolbar pills

**Files:**
- Create: `src/components/editor/toolbar/talking-head-pills.tsx`
- Modify: `src/components/editor/toolbar/talking-head-layers-button.tsx` (delete or replace)
- Modify: wherever the toolbar renders (likely `src/components/editor/toolbar/*-toolbar.tsx`)

- [ ] **Step 1: Implement the 2-pill component**

Create `src/components/editor/toolbar/talking-head-pills.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBuildState } from "@/components/build/build-state-context";
import { getLayerByKind } from "@/lib/talking-head/talking-head-store";
import { detectMattingSupport } from "@/lib/matting/browser-support";
import { AddTalkingHeadDialog } from "@/components/editor/dialogs/add-talking-head-dialog";

export function TalkingHeadPills() {
  const { talkingHeadLayers } = useBuildState();
  const full = getLayerByKind(talkingHeadLayers, "full");
  const overlay = getLayerByKind(talkingHeadLayers, "overlay");
  const [open, setOpen] = useState<null | "full" | "overlay">(null);
  const support = detectMattingSupport();

  return (
    <>
      <Pill
        kind="full"
        label={full ? "talking-head-full" : "Add talking-head-full"}
        filled={!!full}
        onClick={() => setOpen("full")}
      />
      <Pill
        kind="overlay"
        label={
          overlay
            ? overlay.mattingStatus === "processing"
              ? `talking-head-overlay (${overlayProgressPct(overlay)}%)`
              : "talking-head-overlay"
            : "Add talking-head-overlay"
        }
        filled={!!overlay && overlay.mattingStatus === "ready"}
        processing={overlay?.mattingStatus === "processing"}
        disabled={!support.ok}
        tooltip={!support.ok ? "Yêu cầu Chrome/Edge desktop" : undefined}
        onClick={() => setOpen("overlay")}
      />
      {open && (
        <AddTalkingHeadDialog
          kind={open}
          existing={open === "full" ? full : overlay}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function overlayProgressPct(l: { mattingProgress?: { framesDone: number; totalFrames: number } }) {
  const p = l.mattingProgress;
  if (!p || p.totalFrames === 0) return 0;
  return Math.round((p.framesDone / p.totalFrames) * 100);
}

interface PillProps {
  kind: "full" | "overlay";
  label: string;
  filled: boolean;
  processing?: boolean;
  disabled?: boolean;
  tooltip?: string;
  onClick: () => void;
}

function Pill(p: PillProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={p.disabled}
      title={p.tooltip}
      onClick={p.onClick}
      className={cn(
        "gap-2 border-2",
        p.filled && "border-green-500 text-green-300",
        p.processing && "border-yellow-500 text-yellow-300",
        !p.filled && !p.processing && "border-orange-500 text-orange-300",
      )}
    >
      <Video className="size-4" />
      {p.label}
    </Button>
  );
}
```

- [ ] **Step 2: Mount the pills in the toolbar**

Replace the existing `<AddTalkingHeadButton />` (or whatever the existing toolbar uses) with `<TalkingHeadPills />`. Delete the old `talking-head-layers-button.tsx` if its only consumer was the toolbar.

- [ ] **Step 3: Manual smoke check**

Run: `pnpm dev`
Open the editor. Confirm:
- 4 pills visible: Audio, Script, talking-head-full, talking-head-overlay
- All empty pills are orange
- Overlay pill is disabled with tooltip in Safari/Firefox

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/toolbar/talking-head-pills.tsx
git rm src/components/editor/toolbar/talking-head-layers-button.tsx
git commit -m "feat(toolbar): 2 fixed talking-head pills (full + overlay) with green/yellow/orange states"
```

---

### Task 15: Kind-aware upload dialog

**Files:**
- Modify: `src/components/editor/dialogs/add-talking-head-dialog.tsx`

- [ ] **Step 1: Rewrite the dialog as kind-aware**

```tsx
"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBuildState } from "@/components/build/build-state-context";
import type { TalkingHeadKind, TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

const LENGTH_WARN_SEC = 300;

interface Props {
  kind: TalkingHeadKind;
  existing: TalkingHeadLayer | undefined;
  onClose: () => void;
}

export function AddTalkingHeadDialog({ kind, existing, onClose }: Props) {
  const { addTalkingHeadLayer, removeTalkingHeadLayer, abortMatting } = useBuildState();
  const [file, setFile] = useState<File | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<File | null>(null);

  async function handleSubmit(f: File) {
    if (kind === "overlay") {
      const dur = await probeDurationSec(f);
      if (dur > LENGTH_WARN_SEC && !pendingConfirm) {
        setPendingConfirm(f);
        return;
      }
    }
    addTalkingHeadLayer({ kind, file: f });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? `Replace ${kind === "full" ? "talking-head-full" : "talking-head-overlay"}` : `Add ${kind === "full" ? "talking-head-full" : "talking-head-overlay"}`}
          </DialogTitle>
        </DialogHeader>

        {pendingConfirm ? (
          <div className="space-y-3">
            <p>Video dài hơn 5 phút. Matting có thể mất 15+ phút. Tiếp tục?</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingConfirm(null)}>Hủy</Button>
              <Button onClick={() => handleSubmit(pendingConfirm)}>Tiếp tục</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <Input type="file" accept="video/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <DialogFooter className="gap-2">
              {existing && (
                <Button variant="destructive" onClick={() => {
                  if (kind === "overlay" && existing.mattingStatus === "processing") abortMatting(existing.id);
                  else removeTalkingHeadLayer(existing.id);
                  onClose();
                }}>Remove</Button>
              )}
              <Button disabled={!file} onClick={() => file && handleSubmit(file)}>
                {existing ? "Replace" : "Upload"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function probeDurationSec(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.src = url; v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("probe failed")); };
  });
}
```

- [ ] **Step 2: Manual check + commit**

```bash
pnpm dev
# Upload a < 5min mp4 to overlay slot → matting starts, no warn
# Upload a > 5min mp4 → confirm dialog appears
git add src/components/editor/dialogs/add-talking-head-dialog.tsx
git commit -m "feat(toolbar): kind-aware upload dialog with > 5min length warning"
```

---

### Task 16: Matting progress modal

**Files:**
- Create: `src/components/editor/dialogs/matting-progress-modal.tsx`
- Modify: `src/components/editor/toolbar/talking-head-pills.tsx` (open modal on processing pill click)

- [ ] **Step 1: Implement the modal**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBuildState } from "@/components/build/build-state-context";
import { getLayerByKind } from "@/lib/talking-head/talking-head-store";

export function MattingProgressModal({ onClose }: { onClose: () => void }) {
  const { talkingHeadLayers, abortMatting } = useBuildState();
  const layer = getLayerByKind(talkingHeadLayers, "overlay");
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!layer || layer.mattingStatus !== "processing") onClose();
  }, [layer, onClose]);

  if (!layer || layer.mattingStatus !== "processing") return null;
  const p = layer.mattingProgress ?? { framesDone: 0, totalFrames: 1 };
  const pct = Math.round((p.framesDone / Math.max(p.totalFrames, 1)) * 100);
  const elapsedSec = (Date.now() - startedAt) / 1000;
  const etaSec = p.framesDone > 0 ? Math.round((elapsedSec * (p.totalFrames - p.framesDone)) / p.framesDone) : 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Đang tách nền talking-head-overlay</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="h-2 bg-muted rounded overflow-hidden">
            <div className="h-full bg-yellow-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-muted-foreground">
            {p.framesDone.toLocaleString()} / {p.totalFrames.toLocaleString()} frames ({pct}%)
            {etaSec > 0 && ` — còn ~${Math.ceil(etaSec / 60)} phút`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
          <Button variant="destructive" onClick={() => { abortMatting(layer.id); onClose(); }}>Hủy matting</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire modal open on processing pill click**

In `talking-head-pills.tsx`, when the overlay pill is in `processing` state and clicked, open `<MattingProgressModal />` instead of `<AddTalkingHeadDialog />`.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/dialogs/matting-progress-modal.tsx src/components/editor/toolbar/talking-head-pills.tsx
git commit -m "feat(matting): progress modal with abort button + ETA"
```

---

### Task 17: Inspector matting status + retry

**Files:**
- Modify: `src/components/editor/inspector/talking-head-section-inspector.tsx`

- [ ] **Step 1: Add matting status block for overlay layer**

In the inspector, locate the section that renders TH layer info. Add a sub-block visible only when the inspected layer is `kind === 'overlay'`:

```tsx
{layer.kind === "overlay" && (
  <div className="space-y-2">
    <p className="text-sm">Matting: <Badge>{layer.mattingStatus ?? "unknown"}</Badge></p>
    {layer.mattingStatus === "processing" && layer.mattingProgress && (
      <p className="text-xs text-muted-foreground">
        {layer.mattingProgress.framesDone} / {layer.mattingProgress.totalFrames} frames
      </p>
    )}
    {layer.mattingStatus === "failed" && (
      <Button size="sm" onClick={() => retryMatting(layer.id)}>Retry matting</Button>
    )}
  </div>
)}
```

- [ ] **Step 2: Add Restore button for disabled shots**

Add a section showing all keys in `disabledOverlayShots` with a Restore button per key:

```tsx
{disabledOverlayShots.size > 0 && (
  <div className="space-y-1">
    <p className="text-xs font-medium">Disabled overlay shots</p>
    {[...disabledOverlayShots].map((key) => (
      <div key={key} className="flex justify-between items-center text-xs">
        <span>{key}</span>
        <Button size="sm" variant="ghost" onClick={() => restoreOverlayShot(key)}>Restore</Button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/inspector/talking-head-section-inspector.tsx
git commit -m "feat(inspector): show matting status + per-shot restore buttons"
```

---

### Task 18: Timeline overlay shot row + delete handler

**Files:**
- Modify: `src/components/editor/timeline/track-talking-head-layers.tsx` (or a new sibling for overlay row)

- [ ] **Step 1: Render an overlay shot row above the base row**

Locate where TH layer thumbnails are rendered. Add a parallel row that renders one chip per section whose `tags.includes(OVERLAY_TAG)`. Each chip shows a "PIP" icon + sectionKey label, dimmed if its key is in `disabledOverlayShots`.

```tsx
{overlayShots.map((s) => {
  const k = sectionKey({ startMs: s.startMs, endMs: s.endMs });
  const disabled = disabledOverlayShots.has(k);
  const selected = selectedShotKey === k;
  return (
    <div
      key={k}
      tabIndex={0}
      onClick={() => setSelectedShotKey(k)}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (disabled) restoreOverlayShot(k);
          else disableOverlayShot(k);
        }
      }}
      className={cn(
        "h-6 rounded border text-xs flex items-center gap-1 px-2",
        disabled && "opacity-40 line-through",
        selected && "ring-2 ring-blue-500",
      )}
      style={{ position: "absolute", left: pxAtMs(s.startMs), width: pxAtMs(s.durationMs) }}
    >
      <PictureInPicture className="size-3" /> {k}
    </div>
  );
})}
```

- [ ] **Step 2: Manual smoke check**

Build a script with one overlay section, click the chip, press Delete → chip dims; press Delete again → chip restores.

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/timeline/track-talking-head-layers.tsx
git commit -m "feat(timeline): overlay shot row with Delete-to-disable + Delete-to-restore"
```

---

## Phase 6 — Preview composition

### Task 19: Editor canvas composites overlay live

**Files:**
- Modify: wherever the editor preview composes frames (search: `drawImage`)

- [ ] **Step 1: Find the preview compositor**

Run: `grep -rn "drawImage\|ctx.draw" src/components/editor/preview src/lib/playback-plan 2>/dev/null`

Identify the per-frame draw function (likely inside the preview Canvas component).

- [ ] **Step 2: Add an overlay draw pass**

After drawing the base clip for the current section, check `matchedSection.overlayClip` and the disabled set:

```ts
if (matchedSection.overlayClip && !disabledOverlayShots.has(sectionKey(matchedSection))) {
  const mattedVid = mattedVideoRefs.current.get(matchedSection.overlayClip.fileId);
  if (mattedVid && mattedVid.readyState >= 2) {
    const desiredTime = (matchedSection.overlayClip.sourceSeekMs! + localTimeMs) / 1000;
    if (Math.abs(mattedVid.currentTime - desiredTime) > 0.05) mattedVid.currentTime = desiredTime;
    const w = canvas.width * OVERLAY_WIDTH_RATIO;
    const h = (mattedVid.videoHeight / mattedVid.videoWidth) * w;
    const x = canvas.width - w - OVERLAY_PADDING_PX;
    const y = canvas.height - h - OVERLAY_PADDING_PX;
    ctx.drawImage(mattedVid, x, y, w, h);
  }
}
```

- [ ] **Step 3: Set up hidden `<video>` refs for matted files**

In the preview component, hold a `Map<mattedFileId, HTMLVideoElement>` ref. For each overlay layer in build state, create a hidden `<video>` with `src=URL.createObjectURL(mattedBlob)`, `muted`, `playsInline`, attach to the ref map. Revoke on unmount.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/preview/  # or wherever
git commit -m "feat(preview): composite matted overlay onto base canvas per frame"
```

---

### Task 20: Pass matted files to render request

**Files:**
- Modify: `src/components/build/render-trigger.tsx` (or wherever the render request is built)

- [ ] **Step 1: Append matted files to multipart**

In the render fetch, for every overlay layer with `mattingStatus === 'ready'`, append the matted webm:

```ts
for (const layer of talkingHeadLayers) {
  if (layer.kind === "overlay" && layer.mattingStatus === "ready" && layer.mattedFileId) {
    const matted = talkingHeadFiles.get(layer.mattedFileId);
    if (matted) form.append("matted-clips", matted, layer.mattedFileId);
  }
}
```

- [ ] **Step 2: Smoke-render**

Build a project with one overlay section, click Render, verify the downloaded mp4 shows the cutout in the bottom-right corner over the base content.

- [ ] **Step 3: Commit**

```bash
git add src/components/build/render-trigger.tsx
git commit -m "feat(render): include matted webm files in render multipart"
```

---

## Phase 7 — Final polish

### Task 21: README + docs note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a brief section**

Under a "Talking-head overlay" heading:

```markdown
### Talking-head overlay (Chrome / Edge only)

The `talking-head-overlay` layer auto-removes the background from a UGC mp4 in the browser
and composites a cutout onto the bottom-right corner of whatever is playing.

- **Browser**: Chrome or Edge on desktop. Safari, Firefox, and mobile are not supported.
- **Source quality**: best results with a clean background, even lighting, and a clearly
  framed selfie. Hair flyaways and gestures may show edge artifacts.
- **Time**: matting takes 1× to 3× the video duration depending on machine power.
- **Script syntax**: tag sections with `<base>, talking-head-overlay` (e.g. `mower,
  talking-head-overlay`) to enable the cutout for that section.
- **Per-shot disable**: click a shot on the overlay row and press Delete to skip it
  without editing the script.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README note for talking-head-overlay feature + browser requirements"
```

---

### Task 22: Final verification

- [ ] **Step 1: Full test suite**

Run: `pnpm typecheck && pnpm vitest run`
Expected: ALL PASS.

- [ ] **Step 2: Playwright smoke**

Run: `pnpm exec playwright test tests/e2e/matting-smoke.spec.ts`
Expected: PASS.

- [ ] **Step 3: Manual end-to-end**

1. `pnpm dev`
2. Upload an audio mp3, a script with one section tagged `mower, talking-head-overlay`, a `mower` b-roll folder, and a talking-head-full mp4 + a talking-head-overlay mp4.
3. Wait for overlay matting to complete (watch pill turn green).
4. Verify editor preview shows the cutout in the bottom-right.
5. Click the overlay shot chip, press Delete — preview hides the overlay.
6. Restore from the inspector.
7. Click Render. Confirm output mp4 has the cutout where expected.

- [ ] **Step 4: Final commit if any fixes**

```bash
git add -A
git commit -m "fix: address final verification feedback"
```

---

## Self-review notes (for the planner)

**Spec coverage:**
- 2-pill UI → Task 14
- Multi-tag parser → Task 3
- Per-shot delete → Tasks 4, 17, 18
- Matting worker → Tasks 10, 11, 12, 13
- IDB v3 → Task 8
- Render overlay branch → Tasks 6, 7
- Auto-match → Task 5
- Preview composite → Task 19
- Browser gate → Tasks 9, 14
- Length warning → Task 15
- Abort + retry → Tasks 13, 16, 17
- README → Task 21

All spec sections accounted for.

**Type consistency check:**
- `addOrReplaceLayer`, `getLayerByKind`, `setMattingStatus`, `setMattingProgress` consistent across tasks 2, 13, 14, 16, 17.
- `OVERLAY_WIDTH_RATIO`, `OVERLAY_PADDING_PX` exported from `render-segments.ts` (Task 6), reused in Task 19 preview.
- `sectionKey` exported from `lib/matting/section-key.ts` (Task 4), used in tasks 5, 17, 18, 19.
- `OVERLAY_TAG`, `FULL_TAG` exported from `script-parser.ts` (Task 3), used in tasks 4, 5, 18.

**Placeholder scan:**
- One genuine note in Task 7 step 2 (`baseSegs = /* segment paths for current section */`) — the prose explains the running-accumulator pattern; the engineer must wire the variable themselves. Acceptable because the surrounding code is heavily refactored in Task 7 and exact line numbers depend on Task 6 results.
- No "TBD", no empty test bodies.

**Risk gate reminder:**
Task 12 (Playwright smoke) is the de-risk gate. If it fails, **do not** continue to Phase 5 — fix the worker first or escalate to the user about pivoting to server-side matting.
