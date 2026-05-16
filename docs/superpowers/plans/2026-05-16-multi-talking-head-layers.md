# Multi Talking-Head Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global talking-head with N independent talking-head layers, each with its own MP4 + unique tag, each rendered as a separate row on the timeline above the main b-roll track. Main b-roll is visually cut at sections matching a TH layer's tag, TH wins over a b-roll folder of the same name, and TH files persist across reloads via IndexedDB.

**Architecture:** Replace `BuildState.talkingHeadFile / talkingHeadTag` with `BuildState.talkingHeadLayers: TalkingHeadLayer[]` plus an in-memory `talkingHeadFiles: Map<fileId, File>` mirrored to a new `talkingHeadLayers` IndexedDB objectStore. Auto-matcher (`matchSections`) accepts the array and, for each script section, looks up by tag — if any layer matches, it produces a TH slice instead of pulling from the b-roll folder (TH wins over b-roll folder). Timeline gains one `TrackTalkingHead` row per layer between the text-overlay row and the tag row; `TrackClips` filters out TH sections so the main b-roll row reads as "cut" at those ranges. Toolbar pill becomes `TalkingHeadLayersButton` (opens modal listing layers + form to add). Server render pipeline needs no logic change — it already extracts by `fileId + sourceSeekMs` and drops audio per-section.

**Tech Stack:** Next.js 15, React 19, TypeScript, vitest, Tailwind, ffmpeg (native), idb (IndexedDB).

---

## File structure

**New files**
- `src/lib/talking-head/talking-head-types.ts` — `TalkingHeadLayer` interface + `TH_LAYER_FILE_ID_PREFIX`.
- `src/lib/talking-head/talking-head-store.ts` — pure helpers: `addLayer`, `removeLayer`, `renameLayer`, `findLayerByTag`, `migrateFromLegacyTh`.
- `src/lib/talking-head/talking-head-storage.ts` — IndexedDB persistence: `loadAllLayers`, `persistLayer`, `deleteLayer`.
- `src/lib/talking-head/__tests__/talking-head-store.test.ts`
- `src/components/editor/timeline/track-talking-head.tsx` — one row per layer with sparse blocks + delete X button.
- `src/components/editor/toolbar/talking-head-layers-button.tsx` — toolbar entry + counter.
- `src/components/editor/dialogs/talking-head-layers-dialog.tsx` — list + delete + tag edit + add form.

**Modified files**
- `src/lib/media-storage.ts` — bump `DB_VERSION` from 1 → 2; add `talkingHeadLayers` objectStore in `upgrade`.
- `src/lib/auto-match.ts` — `matchSections` takes `talkingHeadLayers: TalkingHeadLayer[]`; lookup by Map<tag, layer>; remove `TalkingHeadConfig` + `TALKING_HEAD_FILE_ID`.
- `src/lib/lock-preserve.ts` — `preserveLocks` signature mirrors `matchSections`.
- `src/lib/shuffle.ts` — `shuffleTimeline` mirrors.
- `src/components/build/build-state-context.tsx` — drop `talkingHeadFile`/`talkingHeadTag`/`talkingHeadDialogOpen`, add `talkingHeadLayers` + `talkingHeadFiles` + setters; load from IndexedDB on mount; update re-match useEffect deps.
- `src/components/build/render-trigger.tsx` — upload every layer's file, not just one.
- `src/components/editor/preview/preview-player.tsx` — Map<fileId, objectURL> for TH playback.
- `src/components/editor/timeline/timeline-panel.tsx` — render the new `TrackTalkingHead` row(s) between text-overlay row and TrackTags.
- `src/components/editor/timeline/track-clips.tsx` — filter out TH sections so the main b-roll row reads as cut.
- `src/components/editor/editor-shell.tsx` — swap `TalkingHeadPill` for `TalkingHeadLayersButton`; remove `TalkingHeadDialog` instance; update purple inspector panel to show `Layer: <tag>`.
- `src/lib/__tests__/auto-match.test.ts` — flip `talkingHead` config arg to array.
- `src/lib/__tests__/lock-preserve.test.ts` — same.

**Deleted files**
- `src/components/editor/toolbar/talking-head-pill.tsx`
- `src/components/editor/dialogs/talking-head-dialog.tsx`

---

## Decisions recap (from brainstorming + grilling rounds)

- Matching: tag-based, sequential auto-slice (`sourceSeekMs = section.startMs`, existing behavior).
- B-roll under TH: visually cut in `TrackClips` (TH layer row shows the slice; render pipeline already produces TH content via `MatchedClip.sourceSeekMs`).
- Layer data model: separate `TalkingHeadLayer[]` config; TH content stays expressed via `MatchedClip.sourceSeekMs` (no new `OverlayItem` variant — keep the kind-aware union focused on user-positioned items).
- Tag unique per layer; **TH wins over b-roll folder with the same name**.
- Persistence: layers + files persisted to IndexedDB via new `talkingHeadLayers` objectStore + existing `files` store. Load on mount.
- Audio: `-an` on per-section encode (unchanged from today).
- File upload to render: all layer files in the same `clips[]` multipart field; server identifies TH via `sourceSeekMs`.
- Empty layer (no section matches its tag): row shown with warning icon (`AlertTriangle`).
- Inspector for selected TH section: existing purple panel + new `Layer: <tag>` line.
- Layer overlap (impossible with unique tags): last-added wins; not a real case.

---

## Task 1: Talking-head layer types

**Files:**
- Create: `src/lib/talking-head/talking-head-types.ts`

- [ ] **Step 1: Create the type file**

```ts
// src/lib/talking-head/talking-head-types.ts

export const TH_LAYER_FILE_ID_PREFIX = "__th_layer__";

/** One talking-head source: a video file paired with a script tag.
 *  The File itself lives in BuildState (in-memory mirror of IndexedDB). */
export interface TalkingHeadLayer {
  /** Stable id (uuid). */
  id: string;
  /** Script tag this layer claims, stored lowercase. */
  tag: string;
  /** Synthetic file id used in MatchedClip.fileId and the multipart upload field name. */
  fileId: string;
  /** Optional human label (defaults to tag in UI when empty). */
  label?: string;
}

export function makeLayerFileId(layerId: string): string {
  return `${TH_LAYER_FILE_ID_PREFIX}${layerId}`;
}

export function isLayerFileId(fileId: string): boolean {
  return fileId.startsWith(TH_LAYER_FILE_ID_PREFIX);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/talking-head/talking-head-types.ts
git commit -m "feat(talking-head): add TalkingHeadLayer type + file-id helpers"
```

---

## Task 2: Pure store helpers for layers (TDD)

**Files:**
- Create: `src/lib/talking-head/talking-head-store.ts`
- Test: `src/lib/talking-head/__tests__/talking-head-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/talking-head/__tests__/talking-head-store.test.ts
import { describe, it, expect } from "vitest";
import {
  addLayer,
  removeLayer,
  renameLayer,
  findLayerByTag,
  migrateFromLegacyTh,
} from "../talking-head-store";

describe("addLayer", () => {
  it("returns { ok: true, layers } when tag is unique", () => {
    const result = addLayer([], { tag: "doctor", file: new File([], "doctor.mp4") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.tag).toBe("doctor");
    expect(result.layers[0]!.fileId.startsWith("__th_layer__")).toBe(true);
  });

  it("lowercases and trims the tag", () => {
    const result = addLayer([], { tag: "  Doctor  ", file: new File([], "x.mp4") });
    expect(result.ok && result.layers[0]!.tag).toBe("doctor");
  });

  it("returns { ok: false } when tag already in use (case-insensitive)", () => {
    const seed = addLayer([], { tag: "doc", file: new File([], "a.mp4") });
    if (!seed.ok) throw new Error("seed failed");
    const result = addLayer(seed.layers, { tag: "DOC", file: new File([], "b.mp4") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate-tag");
  });

  it("rejects empty tag", () => {
    const result = addLayer([], { tag: "   ", file: new File([], "x.mp4") });
    expect(result.ok).toBe(false);
  });
});

describe("removeLayer", () => {
  it("removes by id", () => {
    const seed = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error("seed failed");
    const out = removeLayer(seed.layers, seed.layers[0]!.id);
    expect(out).toHaveLength(0);
  });
});

describe("renameLayer", () => {
  it("changes tag when new tag is unique", () => {
    const seed = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error("seed failed");
    const result = renameLayer(seed.layers, seed.layers[0]!.id, "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layers[0]!.tag).toBe("b");
  });

  it("rejects rename to a tag used by another layer", () => {
    const s1 = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!s1.ok) throw new Error();
    const s2 = addLayer(s1.layers, { tag: "b", file: new File([], "2.mp4") });
    if (!s2.ok) throw new Error();
    const result = renameLayer(s2.layers, s2.layers[1]!.id, "A");
    expect(result.ok).toBe(false);
  });

  it("allows rename when the only conflict is the same layer", () => {
    const seed = addLayer([], { tag: "a", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error();
    const result = renameLayer(seed.layers, seed.layers[0]!.id, "A");
    expect(result.ok).toBe(true);
  });
});

describe("findLayerByTag", () => {
  it("matches lowercased tag", () => {
    const seed = addLayer([], { tag: "doc", file: new File([], "1.mp4") });
    if (!seed.ok) throw new Error();
    expect(findLayerByTag(seed.layers, "Doc")?.tag).toBe("doc");
    expect(findLayerByTag(seed.layers, "missing")).toBeUndefined();
  });
});

describe("migrateFromLegacyTh", () => {
  it("returns empty array when no legacy state", () => {
    expect(migrateFromLegacyTh(null, "")).toEqual({ layers: [], files: new Map() });
  });

  it("returns one layer when legacy file + tag are present", () => {
    const file = new File([], "legacy.mp4");
    const result = migrateFromLegacyTh(file, "talking-head");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]!.tag).toBe("talking-head");
    expect(result.files.size).toBe(1);
    expect(result.files.get(result.layers[0]!.fileId)).toBe(file);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test src/lib/talking-head/__tests__/talking-head-store.test.ts
```

Expected: FAIL (`Cannot find module '../talking-head-store'`).

- [ ] **Step 3: Implement the store**

```ts
// src/lib/talking-head/talking-head-store.ts
import { makeLayerFileId, type TalkingHeadLayer } from "./talking-head-types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function normalize(tag: string): string {
  return tag.trim().toLowerCase();
}

export type StoreOk = { ok: true; layers: TalkingHeadLayer[]; files: Map<string, File> };
export type StoreErr = { ok: false; reason: "duplicate-tag" | "empty-tag" | "not-found" };
export type StoreResult = StoreOk | StoreErr;

export function addLayer(
  layers: TalkingHeadLayer[],
  args: { tag: string; file: File; label?: string },
  filesArg?: Map<string, File>,
): StoreResult {
  const tag = normalize(args.tag);
  if (tag.length === 0) return { ok: false, reason: "empty-tag" };
  if (layers.some((l) => l.tag === tag)) return { ok: false, reason: "duplicate-tag" };
  const id = newId();
  const fileId = makeLayerFileId(id);
  const layer: TalkingHeadLayer = { id, tag, fileId, ...(args.label ? { label: args.label } : {}) };
  const files = new Map(filesArg);
  files.set(fileId, args.file);
  return { ok: true, layers: [...layers, layer], files };
}

export function removeLayer(layers: TalkingHeadLayer[], id: string): TalkingHeadLayer[] {
  return layers.filter((l) => l.id !== id);
}

export function renameLayer(
  layers: TalkingHeadLayer[],
  id: string,
  newTag: string,
): StoreResult {
  const tag = normalize(newTag);
  if (tag.length === 0) return { ok: false, reason: "empty-tag" };
  const target = layers.find((l) => l.id === id);
  if (!target) return { ok: false, reason: "not-found" };
  if (layers.some((l) => l.id !== id && l.tag === tag)) return { ok: false, reason: "duplicate-tag" };
  return {
    ok: true,
    layers: layers.map((l) => (l.id === id ? { ...l, tag } : l)),
    files: new Map(),
  };
}

export function findLayerByTag(
  layers: TalkingHeadLayer[],
  tag: string,
): TalkingHeadLayer | undefined {
  const k = normalize(tag);
  return layers.find((l) => l.tag === k);
}

export function migrateFromLegacyTh(
  legacyFile: File | null,
  legacyTag: string,
): { layers: TalkingHeadLayer[]; files: Map<string, File> } {
  if (!legacyFile || legacyTag.trim().length === 0) return { layers: [], files: new Map() };
  const id = newId();
  const fileId = makeLayerFileId(id);
  return {
    layers: [{ id, tag: normalize(legacyTag), fileId }],
    files: new Map([[fileId, legacyFile]]),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/lib/talking-head/__tests__/talking-head-store.test.ts
```

Expected: PASS — 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/talking-head/
git commit -m "feat(talking-head): pure store helpers with TDD"
```

---

## Task 3: IndexedDB persistence for layers + files

**Files:**
- Modify: `src/lib/media-storage.ts` — bump DB version, add objectStore.
- Create: `src/lib/talking-head/talking-head-storage.ts` — load/save helpers.

- [ ] **Step 1: Bump DB version + create objectStore**

In `src/lib/media-storage.ts`:

```diff
- const DB_VERSION = 1;
+ const DB_VERSION = 2;

  export async function openMediaDB(): Promise<MediaDB> {
    return openDB(DB_NAME, DB_VERSION, {
-     upgrade(db) {
+     upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains("folders")) {
          db.createObjectStore("folders", { keyPath: "id" });
        }
        // ... existing stores
+       if (oldVersion < 2 && !db.objectStoreNames.contains("talkingHeadLayers")) {
+         db.createObjectStore("talkingHeadLayers", { keyPath: "id" });
+       }
      },
    });
  }
```

Also add the record type:

```ts
// in media-storage.ts, near the bottom of the type exports
export interface TalkingHeadLayerRecord {
  id: string;
  tag: string;
  fileId: string;
  label?: string;
  createdAt: Date;
}
```

- [ ] **Step 2: Implement the talking-head storage helpers**

```ts
// src/lib/talking-head/talking-head-storage.ts
import { openMediaDB, type TalkingHeadLayerRecord, type FileRecord } from "@/lib/media-storage";
import type { TalkingHeadLayer } from "./talking-head-types";

export async function loadAllTalkingHeadLayers(): Promise<{
  layers: TalkingHeadLayer[];
  files: Map<string, File>;
}> {
  const db = await openMediaDB();
  const records = (await db.getAll("talkingHeadLayers")) as TalkingHeadLayerRecord[];
  const layers: TalkingHeadLayer[] = records.map((r) => ({
    id: r.id,
    tag: r.tag,
    fileId: r.fileId,
    ...(r.label ? { label: r.label } : {}),
  }));
  const files = new Map<string, File>();
  for (const r of records) {
    const fileRec = (await db.get("files", r.fileId)) as FileRecord | undefined;
    if (!fileRec) continue;
    files.set(r.fileId, new File([fileRec.blob], fileRec.filename, { type: fileRec.type }));
  }
  return { layers, files };
}

export async function persistTalkingHeadLayer(
  layer: TalkingHeadLayer,
  file: File,
): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["talkingHeadLayers", "files"], "readwrite");
  await tx.objectStore("talkingHeadLayers").put({
    id: layer.id,
    tag: layer.tag,
    fileId: layer.fileId,
    ...(layer.label ? { label: layer.label } : {}),
    createdAt: new Date(),
  } satisfies TalkingHeadLayerRecord);
  await tx.objectStore("files").put({
    id: layer.fileId,
    blob: file,
    type: file.type || "video/mp4",
    filename: file.name || "talking-head.mp4",
  });
  await tx.done;
}

export async function persistTalkingHeadLayerTagOnly(layer: TalkingHeadLayer): Promise<void> {
  const db = await openMediaDB();
  await db.put("talkingHeadLayers", {
    id: layer.id,
    tag: layer.tag,
    fileId: layer.fileId,
    ...(layer.label ? { label: layer.label } : {}),
    createdAt: new Date(),
  } satisfies TalkingHeadLayerRecord);
}

export async function deleteTalkingHeadLayer(layerId: string, fileId: string): Promise<void> {
  const db = await openMediaDB();
  const tx = db.transaction(["talkingHeadLayers", "files"], "readwrite");
  await tx.objectStore("talkingHeadLayers").delete(layerId);
  await tx.objectStore("files").delete(fileId);
  await tx.done;
}
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/media-storage.ts src/lib/talking-head/talking-head-storage.ts
git commit -m "feat(talking-head): IndexedDB persistence (DB v2 + new objectStore)"
```

---

## Task 4: Auto-matcher accepts an array of layers

**Files:**
- Modify: `src/lib/auto-match.ts`
- Modify: `src/lib/lock-preserve.ts`
- Modify: `src/lib/shuffle.ts`
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/__tests__/lock-preserve.test.ts`
- Modify: `src/lib/__tests__/shuffle.test.ts`

- [ ] **Step 1: Add new tests for multi-layer behavior**

In `src/lib/__tests__/auto-match.test.ts`, append:

```ts
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

describe("matchSections — multi talking-head layers", () => {
  const layerA: TalkingHeadLayer = { id: "a", tag: "doctor", fileId: "__th_layer__a" };
  const layerB: TalkingHeadLayer = { id: "b", tag: "expert", fileId: "__th_layer__b" };

  it("routes a section to the matching TH layer (by tag, case-insensitive)", () => {
    const sections = [
      { lineNumber: 1, startTime: 0, endTime: 4, tag: "DOCTOR", scriptText: "x", durationMs: 4000 },
    ];
    const matched = matchSections(sections, new Map(), undefined, [layerA, layerB]);
    expect(matched[0]!.clips).toHaveLength(1);
    expect(matched[0]!.clips[0]!.fileId).toBe(layerA.fileId);
    expect(matched[0]!.clips[0]!.sourceSeekMs).toBe(0);
  });

  it("TH wins over b-roll folder of the same name", () => {
    const sections = [
      { lineNumber: 1, startTime: 0, endTime: 4, tag: "doctor", scriptText: "x", durationMs: 4000 },
    ];
    const folder = new Map<string, ClipMetadata[]>([[
      "doctor",
      [{
        id: "c1", fileId: "f1", folderName: "doctor", baseName: "doctor",
        durationMs: 10000, filename: "doctor-1.mp4", width: 1080, height: 1920,
      } as ClipMetadata],
    ]]);
    const matched = matchSections(sections, folder, undefined, [layerA]);
    expect(matched[0]!.clips[0]!.fileId).toBe(layerA.fileId);
  });

  it("routes different sections to different layers", () => {
    const sections = [
      { lineNumber: 1, startTime: 0, endTime: 4, tag: "doctor", scriptText: "x", durationMs: 4000 },
      { lineNumber: 2, startTime: 4, endTime: 8, tag: "expert", scriptText: "y", durationMs: 4000 },
    ];
    const matched = matchSections(sections, new Map(), undefined, [layerA, layerB]);
    expect(matched[0]!.clips[0]!.fileId).toBe(layerA.fileId);
    expect(matched[1]!.clips[0]!.fileId).toBe(layerB.fileId);
  });
});
```

Update every existing test in `auto-match.test.ts` that passes the legacy `{ fileId: TALKING_HEAD_FILE_ID, tag: "..." }` to instead pass `[{ id: "x", tag: "...", fileId: "__th_layer__x" }]`.

- [ ] **Step 2: Confirm tests fail**

```bash
pnpm test src/lib/__tests__/auto-match.test.ts
```

Expected: many failures (signature mismatch).

- [ ] **Step 3: Update `matchSections`**

In `src/lib/auto-match.ts`, replace the talking-head section (lines 218–260) with:

```ts
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
  state?: MatchState,
  talkingHeadLayers: TalkingHeadLayer[] = [],
): MatchedSection[] {
  const s = state ?? createMatchState();
  const layerByTag = new Map<string, TalkingHeadLayer>();
  for (const l of talkingHeadLayers) layerByTag.set(l.tag, l);

  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];
    const startMs = section.startTime * 1000;
    const endMs = section.endTime * 1000;

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, startMs, endMs, durationMs: 0, clips: [], warnings };
    }

    const key = section.tag.toLowerCase();
    const layer = layerByTag.get(key);
    if (layer) {
      return {
        sectionIndex,
        tag: section.tag,
        startMs,
        endMs,
        durationMs: section.durationMs,
        clips: [{
          clipId: "talking-head",
          fileId: layer.fileId,
          speedFactor: 1,
          trimDurationMs: section.durationMs,
          sourceSeekMs: startMs,
          isPlaceholder: false,
        }],
        warnings,
      };
    }

    // ... rest of the function unchanged (b-roll candidate lookup, eligibility, pick)
```

Delete the exported `TALKING_HEAD_FILE_ID` and `TalkingHeadConfig` symbols entirely.

- [ ] **Step 4: Update `preserveLocks` + `shuffleTimeline` signatures**

In `src/lib/lock-preserve.ts`, replace the last parameter `talkingHead: TalkingHeadConfig | null` with `talkingHeadLayers: TalkingHeadLayer[] = []` and pass it through to `matchSections`.

In `src/lib/shuffle.ts`, same change.

Update both test files to pass `[]` or a one-element layer array where the old config-shape was used.

- [ ] **Step 5: Run full suite**

```bash
pnpm typecheck && pnpm test src/lib/
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auto-match.ts src/lib/lock-preserve.ts src/lib/shuffle.ts src/lib/__tests__/
git commit -m "refactor(auto-match): accept TalkingHeadLayer[]; TH wins over b-roll folder"
```

---

## Task 5: BuildState + UI + render-trigger atomic refactor

This task consolidates BuildState changes with every consumer fix so each commit leaves the typecheck clean.

**Files:**
- Modify: `src/components/build/build-state-context.tsx`
- Modify: `src/components/build/render-trigger.tsx`
- Modify: `src/components/editor/preview/preview-player.tsx`
- Modify: `src/components/editor/editor-shell.tsx`
- Modify: `src/components/editor/timeline/timeline-panel.tsx`
- Modify: `src/components/editor/timeline/track-clips.tsx`
- Create: `src/components/editor/timeline/track-talking-head.tsx`
- Create: `src/components/editor/toolbar/talking-head-layers-button.tsx`
- Create: `src/components/editor/dialogs/talking-head-layers-dialog.tsx`
- Delete: `src/components/editor/toolbar/talking-head-pill.tsx`
- Delete: `src/components/editor/dialogs/talking-head-dialog.tsx`

- [ ] **Step 1: Refactor BuildState**

In `src/components/build/build-state-context.tsx`:

a. Remove `talkingHeadFile`, `talkingHeadTag`, `setTalkingHead`, `setTalkingHeadTag`, `talkingHeadDialogOpen`, `setTalkingHeadDialogOpen` from the `BuildState` interface, the `useState` calls, the `useMemo` value object, and the `useMemo` deps.

b. Add to the `BuildState` interface and provider:

```ts
talkingHeadLayers: TalkingHeadLayer[];
talkingHeadFiles: Map<string, File>;
addTalkingHeadLayer: (args: { tag: string; file: File; label?: string }) => Promise<{ ok: boolean; reason?: string }>;
removeTalkingHeadLayer: (id: string) => Promise<void>;
renameTalkingHeadLayer: (id: string, newTag: string) => Promise<{ ok: boolean; reason?: string }>;
```

c. Provider body:

```ts
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";
import {
  addLayer as addLayerPure,
  removeLayer as removeLayerPure,
  renameLayer as renameLayerPure,
} from "@/lib/talking-head/talking-head-store";
import {
  loadAllTalkingHeadLayers,
  persistTalkingHeadLayer,
  persistTalkingHeadLayerTagOnly,
  deleteTalkingHeadLayer as deleteTalkingHeadLayerDB,
} from "@/lib/talking-head/talking-head-storage";

const [talkingHeadLayers, setTalkingHeadLayers] = useState<TalkingHeadLayer[]>([]);
const [talkingHeadFiles, setTalkingHeadFiles] = useState<Map<string, File>>(new Map());

useEffect(() => {
  loadAllTalkingHeadLayers()
    .then(({ layers, files }) => {
      setTalkingHeadLayers(layers);
      setTalkingHeadFiles(files);
    })
    .catch((e) => console.error("[talking-head] load failed:", e));
}, []);

const addTalkingHeadLayer = useCallback(
  async (args: { tag: string; file: File; label?: string }) => {
    const result = addLayerPure(talkingHeadLayers, args, talkingHeadFiles);
    if (!result.ok) return { ok: false, reason: result.reason };
    const newLayer = result.layers[result.layers.length - 1]!;
    try {
      await persistTalkingHeadLayer(newLayer, args.file);
    } catch (e) {
      console.error("[talking-head] persist failed:", e);
      return { ok: false, reason: "persist-failed" };
    }
    setTalkingHeadLayers(result.layers);
    setTalkingHeadFiles(result.files);
    return { ok: true };
  },
  [talkingHeadLayers, talkingHeadFiles],
);

const removeTalkingHeadLayer = useCallback(
  async (id: string) => {
    const layer = talkingHeadLayers.find((l) => l.id === id);
    if (!layer) return;
    try {
      await deleteTalkingHeadLayerDB(id, layer.fileId);
    } catch (e) {
      console.error("[talking-head] delete from DB failed:", e);
    }
    setTalkingHeadLayers((prev) => removeLayerPure(prev, id));
    setTalkingHeadFiles((prev) => {
      const next = new Map(prev);
      next.delete(layer.fileId);
      return next;
    });
  },
  [talkingHeadLayers],
);

const renameTalkingHeadLayer = useCallback(
  async (id: string, newTag: string) => {
    const result = renameLayerPure(talkingHeadLayers, id, newTag);
    if (!result.ok) return { ok: false, reason: result.reason };
    const renamed = result.layers.find((l) => l.id === id)!;
    try {
      await persistTalkingHeadLayerTagOnly(renamed);
    } catch (e) {
      console.error("[talking-head] persist rename failed:", e);
    }
    setTalkingHeadLayers(result.layers);
    return { ok: true };
  },
  [talkingHeadLayers],
);
```

d. Update the re-match `useEffect` (currently lines ~155–172) to depend on `talkingHeadLayers` instead of `talkingHeadFile / talkingHeadTag`, and to pass `talkingHeadLayers` to `preserveLocks`:

```ts
useEffect(() => {
  if (!sections || !timeline) return;
  const clipsByBaseName = buildClipsByBaseName(mediaPoolClips);
  const result = preserveLocks(timeline, sections, clipsByBaseName, talkingHeadLayers);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setTimeline(result.newTimeline);
  if (result.droppedCount > 0) {
    console.warn(`[talking-head re-match] ${result.droppedCount} locks dropped`);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [talkingHeadLayers]);
```

Also update `shuffleTimeline` (line ~182) to call `shuffleTimelineHelper(timeline, clipsByBaseName, talkingHeadLayers)`.

e. Drop `TALKING_HEAD_FILE_ID` import. Drop legacy field assignments from the returned value object.

- [ ] **Step 2: Update render-trigger**

In `src/components/build/render-trigger.tsx`:

```diff
- import { TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
- const { talkingHeadFile, overlays } = useBuildState();
+ const { talkingHeadLayers, talkingHeadFiles, overlays } = useBuildState();

- if (talkingHeadFile && usedFileIds.has(TALKING_HEAD_FILE_ID)) {
-   fd.append("clips", new File([talkingHeadFile], TALKING_HEAD_FILE_ID));
- }
+ for (const layer of talkingHeadLayers) {
+   if (!usedFileIds.has(layer.fileId)) continue;
+   const file = talkingHeadFiles.get(layer.fileId);
+   if (file) fd.append("clips", new File([file], layer.fileId));
+ }
```

- [ ] **Step 3: Update preview-player**

In `src/components/editor/preview/preview-player.tsx`:

```diff
- import { TALKING_HEAD_FILE_ID } from "@/lib/auto-match";
- const { talkingHeadFile, /* ... */ } = useBuildState();
+ const { talkingHeadFiles, /* ... */ } = useBuildState();

- const [talkingHeadUrl, setTalkingHeadUrl] = useState<string | null>(null);
- useEffect(() => {
-   if (!talkingHeadFile) { setTalkingHeadUrl(null); return; }
-   const url = URL.createObjectURL(talkingHeadFile);
-   setTalkingHeadUrl(url);
-   return () => URL.revokeObjectURL(url);
- }, [talkingHeadFile]);
+ const [thUrls, setThUrls] = useState<Map<string, string>>(new Map());
+ useEffect(() => {
+   const next = new Map<string, string>();
+   for (const [fileId, file] of talkingHeadFiles) next.set(fileId, URL.createObjectURL(file));
+   setThUrls(next);
+   return () => { for (const url of next.values()) URL.revokeObjectURL(url); };
+ }, [talkingHeadFiles]);
```

Where the player resolves a clip URL (search the file for `talkingHeadUrl` / `TALKING_HEAD_FILE_ID`), replace with `thUrls.get(clip.fileId) ?? mediaPool.getFileURL(clip.fileId)`. TH fileIds (`__th_layer__<uuid>`) never collide with media-pool ids.

- [ ] **Step 4: Create `TrackTalkingHead` component**

```tsx
// src/components/editor/timeline/track-talking-head.tsx
"use client";
import { Trash2, AlertTriangle } from "lucide-react";
import { useBuildState } from "@/components/build/build-state-context";
import type { MatchedSection } from "@/lib/auto-match";
import type { TalkingHeadLayer } from "@/lib/talking-head/talking-head-types";

interface RowProps {
  layer: TalkingHeadLayer;
  timeline: MatchedSection[] | null;
  pxPerSecond: number;
  selectedSectionIndex: number | null;
  onSelectSection: (i: number) => void;
  onRemoveLayer: (id: string) => void;
}

function LayerRow({ layer, timeline, pxPerSecond, selectedSectionIndex, onSelectSection, onRemoveLayer }: RowProps) {
  const matches = (timeline ?? []).filter((s) => s.tag.toLowerCase() === layer.tag);
  return (
    <div className="relative h-10 flex items-stretch border-b border-border/50 group">
      <div className="absolute left-0 top-0 bottom-0 w-32 z-10 flex items-center gap-1 px-2 bg-background/95 backdrop-blur-sm border-r border-border text-[10px]">
        <span className="font-mono text-purple-300 truncate flex-1">{layer.tag}</span>
        {matches.length === 0 && (
          <span title="No section matches this tag yet">
            <AlertTriangle className="w-3 h-3 text-yellow-400" />
          </span>
        )}
        <button
          onClick={() => onRemoveLayer(layer.id)}
          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
          aria-label={`Delete layer ${layer.tag}`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="absolute left-32 top-0 bottom-0 right-0">
        {matches.map((s) => {
          const left = (s.startMs / 1000) * pxPerSecond;
          const width = (s.durationMs / 1000) * pxPerSecond;
          const isSelected = timeline?.[selectedSectionIndex ?? -1] === s;
          return (
            <button
              key={s.sectionIndex}
              type="button"
              onClick={() => onSelectSection(s.sectionIndex)}
              className={
                "absolute top-1 bottom-1 px-1.5 rounded-sm text-[10px] flex items-center truncate transition " +
                (isSelected
                  ? "bg-purple-500/40 border border-purple-300 text-white"
                  : "bg-purple-500/20 border border-purple-500/60 text-purple-100 hover:bg-purple-500/30")
              }
              style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
              title={`${layer.tag} · ${s.durationMs}ms`}
            >
              <span className="truncate">{s.tag}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TrackTalkingHead({ pxPerSecond }: { pxPerSecond: number }) {
  const {
    talkingHeadLayers,
    timeline,
    selectedSectionIndex,
    setSelectedSectionIndex,
    removeTalkingHeadLayer,
  } = useBuildState();
  if (talkingHeadLayers.length === 0) return null;
  return (
    <div>
      {talkingHeadLayers.map((layer) => (
        <LayerRow
          key={layer.id}
          layer={layer}
          timeline={timeline}
          pxPerSecond={pxPerSecond}
          selectedSectionIndex={selectedSectionIndex}
          onSelectSection={setSelectedSectionIndex}
          onRemoveLayer={removeTalkingHeadLayer}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Wire `TrackTalkingHead` into `timeline-panel.tsx`**

Add import and insert between the text-overlay row (if present) and `<TrackTags>`. Concretely insert this single line in the timeline JSX:

```tsx
<TrackTalkingHead pxPerSecond={effectivePxPerSec} />
```

- [ ] **Step 6: TrackClips skips TH sections**

In `src/components/editor/timeline/track-clips.tsx`, drop the `useBuildState()` line that pulls `talkingHeadFile`, and skip TH sections in the render loop:

```diff
- const { talkingHeadFile } = useBuildState();

  return (
    <div className="relative h-[90px] flex items-stretch bg-muted/10">
      {timeline.map((section, i) => {
+       const isTalkingHead = section.clips.some((c) => c.sourceSeekMs !== undefined);
+       if (isTalkingHead) return null;
        const left = (section.startMs / 1000) * pxPerSecond;
        // ... rest unchanged
```

Remove the now-unused `isTalkingHead` recomputation deeper in the same render (the early `return null` above replaces it).

- [ ] **Step 7: Create `TalkingHeadLayersButton`**

```tsx
// src/components/editor/toolbar/talking-head-layers-button.tsx
"use client";
import { Video } from "lucide-react";
import { useState } from "react";
import { useBuildState } from "@/components/build/build-state-context";
import { TalkingHeadLayersDialog } from "../dialogs/talking-head-layers-dialog";

export function TalkingHeadLayersButton() {
  const { talkingHeadLayers } = useBuildState();
  const [open, setOpen] = useState(false);
  const n = talkingHeadLayers.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-background hover:bg-muted text-xs"
        title="Manage talking-head layers"
      >
        <Video className="w-3.5 h-3.5" />
        {n === 0 ? "Add talking-head" : `Talking-head: ${n}`}
      </button>
      <TalkingHeadLayersDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 8: Create `TalkingHeadLayersDialog`**

```tsx
// src/components/editor/dialogs/talking-head-layers-dialog.tsx
"use client";
import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useBuildState } from "@/components/build/build-state-context";

interface Props { open: boolean; onOpenChange: (v: boolean) => void }

export function TalkingHeadLayersDialog({ open, onOpenChange }: Props) {
  const {
    talkingHeadLayers,
    addTalkingHeadLayer,
    removeTalkingHeadLayer,
    renameTalkingHeadLayer,
  } = useBuildState();
  const [tag, setTag] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function reset() { setTag(""); setFile(null); setError(null); if (fileRef.current) fileRef.current.value = ""; }

  async function onAdd() {
    if (!file) { setError("Pick an MP4."); return; }
    if (tag.trim().length === 0) { setError("Tag is required."); return; }
    if (file.size === 0) { setError("File is empty."); return; }
    const result = await addTalkingHeadLayer({ tag, file });
    if (!result.ok) {
      setError(
        result.reason === "duplicate-tag" ? "Tag already in use by another layer." :
        result.reason === "empty-tag" ? "Tag is required." :
        result.reason === "persist-failed" ? "Browser storage failed. File too big?" :
        "Cannot add layer.",
      );
      return;
    }
    reset();
  }

  async function onRename(id: string, newTag: string) {
    const result = await renameTalkingHeadLayer(id, newTag);
    if (!result.ok) {
      setError(result.reason === "duplicate-tag" ? "Tag already in use." : "Cannot rename.");
    } else {
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-lg">
        <DialogHeader>
          <DialogTitle>Talking-head layers</DialogTitle>
          <DialogDescription>
            Each layer maps one MP4 (audio ignored) to a script tag. Sections with that tag will be sliced from this video.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {talkingHeadLayers.map((l) => (
            <li key={l.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/30">
              <input
                defaultValue={l.tag}
                onBlur={(e) => { const v = e.target.value; if (v !== l.tag) void onRename(l.id, v); }}
                className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded"
              />
              <button
                onClick={() => void removeTalkingHeadLayer(l.id)}
                className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                aria-label={`Delete layer ${l.tag}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
          {talkingHeadLayers.length === 0 && (
            <li className="text-xs text-muted-foreground italic">No layers yet.</li>
          )}
        </ul>

        <div className="pt-3 border-t border-border space-y-2">
          <div className="text-xs font-medium">Add new</div>
          <div className="flex gap-2">
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="tag (e.g. doctor)"
              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-muted"
            >
              <Upload className="w-3 h-3" /> {file ? file.name.slice(0, 20) : "Pick MP4"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => void onAdd()}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Add
            </button>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 9: Update `editor-shell.tsx`**

```diff
- import { TalkingHeadPill } from "./toolbar/talking-head-pill";
+ import { TalkingHeadLayersButton } from "./toolbar/talking-head-layers-button";
- import { TalkingHeadDialog } from "./dialogs/talking-head-dialog";

  // ... destructure
- const { /* ..., */ talkingHeadDialogOpen, setTalkingHeadDialogOpen, /* ... */ } = useBuildState();
+ const { /* ... unchanged ... */ talkingHeadLayers, /* ... */ } = useBuildState();

  // ... in the toolbar JSX
-   <TalkingHeadPill />
+   <TalkingHeadLayersButton />

  // ... in the purple-inspector branch where TH section is selected
   <div className="text-xs font-semibold text-purple-300">Talking-head slice</div>
+  <div className="text-[10px] text-purple-300/80">
+    Layer: {talkingHeadLayers.find((l) => l.tag === selectedSection.tag.toLowerCase())?.tag ?? "(unknown)"}
+  </div>
   <div className="text-xs text-muted-foreground tabular-nums">
     {formatMs(selectedSection.startMs)} → {formatMs(selectedSection.endMs)}
     ...

  // ... remove the TalkingHeadDialog instance
-   <TalkingHeadDialog open={talkingHeadDialogOpen} onOpenChange={setTalkingHeadDialogOpen} />
```

- [ ] **Step 10: Delete old files**

```bash
git rm src/components/editor/toolbar/talking-head-pill.tsx
git rm src/components/editor/dialogs/talking-head-dialog.tsx
```

- [ ] **Step 11: Typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

Expected: both clean. If anything still references the deleted symbols, the previous step's grep should have caught it.

- [ ] **Step 12: End-to-end smoke**

1. Reload browser at `localhost:3000`.
2. Upload audio + script (with a section tagged `doctor`).
3. Click "Add talking-head" → modal → upload `doctor.mp4`, tag `doctor`, click Add.
4. New row appears with a purple block at the matching section's time range.
5. Main b-roll row (TrackClips) shows empty at that range (TH section skipped).
6. Click block in TH row → section selected → purple inspector shows `Layer: doctor`.
7. Reload page → layers + files restored from IndexedDB.
8. Click Export → resulting MP4 plays the TH source video (silent) during that section.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(talking-head): multi-layer state + UI + render-trigger atomic refactor

- BuildState: replace talkingHeadFile/Tag with talkingHeadLayers[] + talkingHeadFiles Map; load from IndexedDB on mount
- New TalkingHeadLayersButton + Dialog (list + add/delete/rename)
- New TrackTalkingHead row per layer (sparse blocks, delete X, warning icon when empty)
- TrackClips skips TH sections so main b-roll reads as cut
- preview-player + render-trigger resolve TH file by fileId across layers
- editor-shell purple inspector shows Layer: <tag>
- Remove legacy TalkingHeadPill, TalkingHeadDialog, TALKING_HEAD_FILE_ID consumers"
```

---

## Task 6: Cleanup verification

**Files:**
- Various (verification only).

- [ ] **Step 1: Confirm no straggler symbols**

```bash
grep -rn "TALKING_HEAD_FILE_ID\|talkingHeadFile\b\|talkingHeadTag\b\|TalkingHeadConfig\b\|talkingHeadDialogOpen" src/ 2>/dev/null
```

Expected: zero hits.

- [ ] **Step 2: Run full suite**

```bash
pnpm typecheck && pnpm test && pnpm lint
```

Expected: clean (lint may surface unused imports — fix any).

- [ ] **Step 3: Commit (if anything trailed)**

```bash
git add -A
git commit -m "chore(talking-head): final cleanup of legacy single-TH symbols" --allow-empty
```

---

## Self-review

**Spec coverage:**
- Multi-layer data model → Task 1, 2, 5 ✓
- Tag uniqueness (case-insensitive) → Task 2 + tests ✓
- TH wins over b-roll folder → Task 4 ✓
- Persistence across reloads → Task 3 + Task 5 step 1 ✓
- TH timeline row between TextOverlay and TrackTags → Task 5 step 5 ✓
- "+ Add talking-head" button + modal → Task 5 steps 7–8 ✓
- Delete X per layer → modal (step 8) + row (step 4) ✓
- Inspector shows layer tag → Task 5 step 9 ✓
- TrackClips visually cut at TH ranges → Task 5 step 6 ✓
- Empty layer warning → Task 5 step 4 (`AlertTriangle` when `matches.length === 0`) ✓
- Re-match auto-trigger on layer change → Task 5 step 1d (useEffect dep `[talkingHeadLayers]`) ✓
- File upload to server via existing multipart → Task 5 step 2 ✓
- Audio mute via existing `-an` → no change needed; explicit in plan header ✓

**Placeholder scan:** no TBDs, no "implement later", every step has runnable code/commands.

**Type consistency:** `TalkingHeadLayer` shape used identically across Tasks 1, 3, 4, 5. `StoreResult` shape (`{ ok, layers, files } | { ok: false, reason }`) consistent across helpers + provider. `TalkingHeadLayerRecord` shape consistent between `media-storage.ts` and `talking-head-storage.ts`.

**Risk flagged:** Task 5 is large (~12 sub-steps in one commit). The atomic structure is by design (typecheck must pass at every commit), but execution should still proceed step-by-step with the subagent reading the plan top-to-bottom. If a step fails in isolation, the engineer should revert and start the task over rather than commit partial work.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-16-multi-talking-head-layers.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Recommended for Task 5 specifically since it has 13 sub-steps that benefit from a focused subagent context.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.
