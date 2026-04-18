# B-Roll Name-Based Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace folder-based B-roll matching with B-roll name–based matching, build the full B-roll library manager, and complete the Build Video pipeline.

**Architecture:** Clips carry a `brollName` field (`{base-name}-{NN}`, all lowercase) that is the sole match key. Auto-match derives `baseName = brollName.replace(/-\d+$/, '')` and looks up all variants. Folders are free-form UI organization only — ignored by matching. Script tags match case-insensitively against distinct base names in the product's clip library.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Supabase PostgreSQL, IndexedDB (`idb`), FFmpeg.wasm (`@ffmpeg/ffmpeg`), React 19, Tailwind CSS 4, shadcn/ui, Vitest (unit tests), better-auth.

**Spec:** `docs/superpowers/specs/2026-04-18-broll-name-matching-design.md`

---

## Scope Note

This plan covers two independently shippable phases:
- **Phase A (Tasks 1–14):** Library Manager — users can manage B-roll folders and clips.
- **Phase B (Tasks 15–22):** Build Video — users can parse scripts, auto-match clips, and render MP4s.

Each phase produces working software. Tackle Phase A first.

---

## File Map

```
src/lib/
  schema.ts          — extend with products, folders, clips tables
  broll.ts           — NEW: naming convention helpers + types
  clip-storage.ts    — NEW: IndexedDB wrapper for clip binaries
  ffmpeg.ts          — NEW: FFmpeg.wasm singleton loader
  script-parser.ts   — NEW: pure TS script parser
  auto-match.ts      — NEW: pure TS auto-match engine

src/app/api/products/
  route.ts                                    — GET list, POST create
  [id]/route.ts                               — GET, PUT, DELETE
  [id]/folders/route.ts                       — GET list, POST create
  [id]/folders/[folderId]/route.ts            — PUT rename, DELETE
  [id]/folders/[folderId]/clips/route.ts      — GET list, POST create
  [id]/clips/route.ts                         — GET all in product
  [id]/clips/[clipId]/route.ts                — PATCH rename/move, DELETE

src/app/dashboard/
  page.tsx                    — rewrite: product card grid
  [productId]/page.tsx        — NEW: workspace (library + build tabs)
  [productId]/build/page.tsx  — NEW: 4-step Build Video page

src/components/
  broll/folder-sidebar.tsx    — NEW
  broll/clip-grid.tsx         — NEW
  broll/clip-upload.tsx       — NEW
  build/step-wrapper.tsx      — NEW
  build/audio-upload.tsx      — NEW
  build/script-paste.tsx      — NEW
  build/timeline-preview.tsx  — NEW
  build/render-trigger.tsx    — NEW

src/workers/
  render-worker.ts            — NEW: FFmpeg render Web Worker

next.config.ts      — add COOP/COEP headers
vitest.config.ts    — NEW: test runner config
```

---

## Task 1: Install dependencies + test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add @ffmpeg/ffmpeg @ffmpeg/util idb
```

- [ ] **Step 2: Install test deps**

```bash
pnpm add -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Add test scripts to package.json**

In `package.json` `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 5: Verify**

```bash
pnpm test
```

Expected: "No test files found, exiting with code 0" (no tests yet — that's fine).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add ffmpeg, idb deps and vitest test runner"
```

---

## Task 2: COOP/COEP headers

**Files:**
- Modify: `next.config.ts`

FFmpeg.wasm requires `SharedArrayBuffer`, which requires these headers on every response.

- [ ] **Step 1: Add COOP/COEP to next.config.ts**

Replace the existing `headers()` function:

```ts
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      ],
    },
  ];
},
```

- [ ] **Step 2: Verify dev server starts**

```bash
pnpm dev
```

Open Chrome → DevTools → Network → pick any request → check Response Headers includes `cross-origin-opener-policy: same-origin`.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat: add COOP/COEP headers for SharedArrayBuffer support"
```

---

## Task 3: broll.ts helper module (TDD)

**Files:**
- Create: `src/lib/broll.ts`
- Create: `src/lib/__tests__/broll.test.ts`

- [ ] **Step 1: Create test file**

```ts
// src/lib/__tests__/broll.test.ts
import { describe, it, expect } from "vitest";
import {
  deriveBaseName,
  isValidBrollName,
  filenameToBrollName,
  BROLL_NAME_PATTERN,
} from "../broll";

describe("deriveBaseName", () => {
  it("strips numeric suffix", () => {
    expect(deriveBaseName("fs-dremel-loadnshake-01")).toBe("fs-dremel-loadnshake");
  });
  it("strips multi-digit suffix", () => {
    expect(deriveBaseName("hook-12")).toBe("hook");
  });
  it("strips single-digit suffix", () => {
    expect(deriveBaseName("hook-1")).toBe("hook");
  });
  it("does not strip non-numeric trailing segment", () => {
    expect(deriveBaseName("product-in-use-labrador")).toBe("product-in-use-labrador");
  });
  it("handles name with no dash", () => {
    expect(deriveBaseName("hook01")).toBe("hook01");
  });
});

describe("isValidBrollName", () => {
  it("accepts valid name", () => {
    expect(isValidBrollName("fs-dremel-loadnshake-01")).toBe(true);
  });
  it("accepts single-segment base", () => {
    expect(isValidBrollName("hook-01")).toBe(true);
  });
  it("rejects uppercase", () => {
    expect(isValidBrollName("FS-dremel-01")).toBe(false);
  });
  it("rejects missing numeric suffix", () => {
    expect(isValidBrollName("fs-dremel-loadnshake")).toBe(false);
  });
  it("rejects non-numeric suffix", () => {
    expect(isValidBrollName("product-labrador")).toBe(false);
  });
  it("rejects spaces", () => {
    expect(isValidBrollName("fs dremel-01")).toBe(false);
  });
  it("rejects special chars", () => {
    expect(isValidBrollName("fs_dremel-01")).toBe(false);
  });
});

describe("filenameToBrollName", () => {
  it("strips .mp4 and lowercases", () => {
    expect(filenameToBrollName("FS-Dremel-LoadNShake-01.mp4")).toBe("fs-dremel-loadnshake-01");
  });
  it("handles uppercase .MP4", () => {
    expect(filenameToBrollName("Hook-01.MP4")).toBe("hook-01");
  });
  it("file already lowercase", () => {
    expect(filenameToBrollName("hook-01.mp4")).toBe("hook-01");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm test
```

Expected: multiple failures (module not found).

- [ ] **Step 3: Implement broll.ts**

```ts
// src/lib/broll.ts
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

- [ ] **Step 4: Run tests — expect all pass**

```bash
pnpm test
```

Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/broll.ts src/lib/__tests__/broll.test.ts
git commit -m "feat: add broll naming convention helpers with tests"
```

---

## Task 4: Schema — products, folders, clips tables

**Files:**
- Modify: `src/lib/schema.ts`

- [ ] **Step 1: Reset old database**

```bash
pnpm db:reset
```

Expected: drops old `tags`/`clips`/`products` tables. Confirm in Supabase table editor that these tables are gone.

- [ ] **Step 2: Clear IndexedDB**

Open Chrome → DevTools → Application → IndexedDB → `broll-auto-assembly` → Delete database.

- [ ] **Step 3: Extend schema.ts**

Add after the existing `verification` table (keep auth tables untouched):

```ts
import {
  pgTable, text, timestamp, boolean, index,
  uuid, varchar, integer, bigint, uniqueIndex,
} from "drizzle-orm/pg-core";

// ... (existing auth tables unchanged) ...

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("products_user_id_idx").on(t.userId)],
);

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

- [ ] **Step 4: Generate and push migration**

```bash
pnpm db:generate
pnpm db:push
```

Expected: creates `products`, `folders`, `clips` tables in Supabase. Verify in table editor.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schema.ts drizzle/
git commit -m "feat: add products, folders, clips schema for broll library"
```

---

## Task 5: IndexedDB wrapper

**Files:**
- Create: `src/lib/clip-storage.ts`

IndexedDB cannot be tested in Node. These are integration tests run manually in Chrome.

- [ ] **Step 1: Create clip-storage.ts**

```ts
// src/lib/clip-storage.ts
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "broll-auto-assembly";
const DB_VERSION = 1;

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("clips")) {
        db.createObjectStore("clips");
      }
      if (!db.objectStoreNames.contains("thumbnails")) {
        db.createObjectStore("thumbnails");
      }
    },
  });
}

export async function saveClip(id: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put("clips", data, id);
}

export async function saveThumbnail(clipId: string, data: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put("thumbnails", data, clipId);
}

export async function getClip(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return db.get("clips", id);
}

export async function getThumbnail(clipId: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return db.get("thumbnails", clipId);
}

export async function deleteClip(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("clips", id);
  await db.delete("thumbnails", id);
}

export async function deleteProductClips(clipIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["clips", "thumbnails"], "readwrite");
  await Promise.all(
    clipIds.flatMap((id) => [
      tx.objectStore("clips").delete(id),
      tx.objectStore("thumbnails").delete(id),
    ]),
  );
  await tx.done;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/clip-storage.ts
git commit -m "feat: add IndexedDB wrapper for clip binary storage"
```

---

## Task 6: FFmpeg.wasm singleton loader

**Files:**
- Create: `src/lib/ffmpeg.ts`

- [ ] **Step 1: Create ffmpeg.ts**

```ts
// src/lib/ffmpeg.ts
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let instance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function loadFFmpeg(): Promise<FFmpeg> {
  if (instance?.loaded) return instance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    instance = ffmpeg;
    loadPromise = null;
    return ffmpeg;
  })();

  return loadPromise;
}

export function isFFmpegLoaded(): boolean {
  return instance?.loaded ?? false;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ffmpeg.ts
git commit -m "feat: add FFmpeg.wasm singleton loader"
```

---

## Task 7: Product API routes

**Files:**
- Create: `src/app/api/products/route.ts`
- Create: `src/app/api/products/[id]/route.ts`

- [ ] **Step 1: Create route.ts for list + create**

```ts
// src/app/api/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await requireAuth();
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.userId, session.user.id))
    .orderBy(desc(products.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await requireAuth();
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const [product] = await db
    .insert(products)
    .values({ name: name.trim(), userId: session.user.id })
    .returning();
  return NextResponse.json(product, { status: 201 });
}
```

- [ ] **Step 2: Create [id]/route.ts**

```ts
// src/app/api/products/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function getOwnedProduct(productId: string, userId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  return product ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const product = await getOwnedProduct(id, session.user.id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(product);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const product = await getOwnedProduct(id, session.user.id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const [updated] = await db
    .update(products)
    .set({ name: name.trim(), updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const product = await getOwnedProduct(id, session.user.id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Fetch clip IDs before cascade-delete (for IndexedDB cleanup response)
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.productId, id));
  await db.delete(products).where(eq(products.id, id));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
```

- [ ] **Step 3: Test manually**

Start `pnpm dev`. Use a REST client or browser:
```
POST /api/products  {"name": "Dog Grooming VSL"}  → 201 with product
GET  /api/products                                 → array with 1 item
GET  /api/products/:id                             → that product
PUT  /api/products/:id  {"name": "Nail Trim VSL"}  → updated
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/products/
git commit -m "feat: add product CRUD API routes"
```

---

## Task 8: Folder API routes

**Files:**
- Create: `src/app/api/products/[id]/folders/route.ts`
- Create: `src/app/api/products/[id]/folders/[folderId]/route.ts`

- [ ] **Step 1: Create folders/route.ts**

```ts
// src/app/api/products/[id]/folders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";

async function assertOwnership(productId: string, userId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  return p ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  if (!await assertOwnership(id, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      sortOrder: folders.sortOrder,
      createdAt: folders.createdAt,
      clipCount: sql<number>`cast(count(${clips.id}) as int)`,
    })
    .from(folders)
    .leftJoin(clips, eq(clips.folderId, folders.id))
    .where(eq(folders.productId, id))
    .groupBy(folders.id)
    .orderBy(folders.sortOrder, folders.name);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  if (!await assertOwnership(id, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const [folder] = await db
      .insert(folders)
      .values({ productId: id, name: name.trim() })
      .returning();
    return NextResponse.json(folder, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Folder name already exists" }, { status: 409 });
  }
}
```

- [ ] **Step 2: Create folders/[folderId]/route.ts**

```ts
// src/app/api/products/[id]/folders/[folderId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function assertFolderOwnership(productId: string, folderId: string, userId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  if (!p) return null;
  const [f] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.productId, productId)));
  return f ?? null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const session = await requireAuth();
  const { id, folderId } = await params;
  const folder = await assertFolderOwnership(id, folderId, session.user.id);
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const [updated] = await db
      .update(folders)
      .set({ name: name.trim() })
      .where(eq(folders.id, folderId))
      .returning();
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Folder name already exists" }, { status: 409 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const session = await requireAuth();
  const { id, folderId } = await params;
  const folder = await assertFolderOwnership(id, folderId, session.user.id);
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.folderId, folderId));
  await db.delete(folders).where(eq(folders.id, folderId));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/products/
git commit -m "feat: add folder CRUD API routes"
```

---

## Task 9: Clips API routes

**Files:**
- Create: `src/app/api/products/[id]/folders/[folderId]/clips/route.ts`
- Create: `src/app/api/products/[id]/clips/route.ts`
- Create: `src/app/api/products/[id]/clips/[clipId]/route.ts`

- [ ] **Step 1: Create per-folder clips route**

```ts
// src/app/api/products/[id]/folders/[folderId]/clips/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { isValidBrollName } from "@/lib/broll";

async function assertFolderOwnership(productId: string, folderId: string, userId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  if (!p) return null;
  const [f] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.productId, productId)));
  return f ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const session = await requireAuth();
  const { id, folderId } = await params;
  if (!await assertFolderOwnership(id, folderId, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(clips)
    .where(and(eq(clips.folderId, folderId), eq(clips.productId, id)))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const session = await requireAuth();
  const { id, folderId } = await params;
  if (!await assertFolderOwnership(id, folderId, session.user.id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const { brollName, filename, durationMs, width, height, indexeddbKey, fileSizeBytes } = body;

  if (!isValidBrollName(brollName)) {
    return NextResponse.json(
      { error: "Invalid brollName. Must match ^[a-z0-9-]+-\\d+$" },
      { status: 400 },
    );
  }

  try {
    const [clip] = await db
      .insert(clips)
      .values({ productId: id, folderId, brollName, filename, durationMs, width, height, indexeddbKey, fileSizeBytes })
      .returning();
    return NextResponse.json(clip, { status: 201 });
  } catch {
    return NextResponse.json({ error: "B-roll name already exists in this product" }, { status: 409 });
  }
}
```

- [ ] **Step 2: Create product-wide clips route**

```ts
// src/app/api/products/[id]/clips/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.userId, session.user.id)));
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.productId, id))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}
```

- [ ] **Step 3: Create clip PATCH/DELETE route**

```ts
// src/app/api/products/[id]/clips/[clipId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, clips, folders } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { isValidBrollName } from "@/lib/broll";

async function assertClipOwnership(productId: string, clipId: string, userId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  if (!p) return null;
  const [clip] = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, clipId), eq(clips.productId, productId)));
  return clip ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const session = await requireAuth();
  const { id, clipId } = await params;
  const clip = await assertClipOwnership(id, clipId, session.user.id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updates: Partial<typeof clips.$inferInsert> = {};

  if (body.brollName !== undefined) {
    if (!isValidBrollName(body.brollName)) {
      return NextResponse.json({ error: "Invalid brollName" }, { status: 400 });
    }
    updates.brollName = body.brollName;
  }

  if (body.folderId !== undefined) {
    const [folder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.folderId), eq(folders.productId, id)));
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 400 });
    updates.folderId = body.folderId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(clips)
      .set(updates)
      .where(eq(clips.id, clipId))
      .returning();
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "B-roll name already exists in this product" }, { status: 409 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const session = await requireAuth();
  const { id, clipId } = await params;
  const clip = await assertClipOwnership(id, clipId, session.user.id);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(clips).where(eq(clips.id, clipId));
  return NextResponse.json({ deletedClipId: clipId });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/products/
git commit -m "feat: add clips CRUD API routes (per-folder, product-wide, patch/delete)"
```

---

## Task 10: Dashboard page — product grid

**Files:**
- Modify: `src/app/dashboard/page.tsx`

Replace the existing starter-kit dashboard with a product management UI.

- [ ] **Step 1: Rewrite dashboard/page.tsx**

```tsx
// src/app/dashboard/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Product = { id: string; name: string; updatedAt: string };

export default function DashboardPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => { setProducts(data); setLoading(false); });
  }, []);

  async function createProduct() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const product = await res.json();
    setProducts((prev) => [product, ...prev]);
    setNewName("");
    setDialogOpen(false);
    setCreating(false);
  }

  async function deleteProduct(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this product and all its clips?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    const { deletedClipIds } = await res.json();
    // Clean up IndexedDB for orphaned clips
    if (deletedClipIds?.length) {
      const { deleteProductClips } = await import("@/lib/clip-storage");
      await deleteProductClips(deletedClipIds);
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Products</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Product</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Product</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Product name</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createProduct()}
                  placeholder="Dog Grooming VSL"
                />
              </div>
              <Button onClick={createProduct} disabled={creating || !newName.trim()} className="w-full">
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <Film className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No products yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/dashboard/${p.id}`)}
              className="p-5 border border-border rounded-lg cursor-pointer hover:bg-accent transition-colors relative group"
            >
              <h2 className="font-semibold text-lg mb-1">{p.name}</h2>
              <p className="text-sm text-muted-foreground">
                Updated {new Date(p.updatedAt).toLocaleDateString()}
              </p>
              <button
                onClick={(e) => deleteProduct(p.id, e)}
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:3000/dashboard`. Create a product, verify card appears, click card navigates to `/dashboard/:id` (404 is fine for now).

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: rewrite dashboard as product management grid"
```

---

## Task 11: Workspace page + folder sidebar

**Files:**
- Create: `src/app/dashboard/[productId]/page.tsx`
- Create: `src/components/broll/folder-sidebar.tsx`

- [ ] **Step 1: Create folder-sidebar.tsx**

```tsx
// src/components/broll/folder-sidebar.tsx
"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, FolderOpen, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Folder = { id: string; name: string; clipCount: number };

interface FolderSidebarProps {
  folders: Folder[];
  activeFolderId: string | null; // null = "All clips"
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  totalClipCount: number;
}

export function FolderSidebar({
  folders,
  activeFolderId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  totalClipCount,
}: FolderSidebarProps) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleCreate() {
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName("");
    setAdding(false);
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    await onRename(id, editName.trim());
    setEditingId(null);
  }

  return (
    <aside className="w-56 shrink-0 border-r border-border h-full overflow-y-auto flex flex-col">
      <div className="p-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
        Library
      </div>

      {/* All Clips virtual entry */}
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-accent ${activeFolderId === null ? "bg-accent font-medium" : ""}`}
      >
        <Library className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">All clips</span>
        <span className="text-xs text-muted-foreground">{totalClipCount}</span>
      </button>

      <div className="p-3 text-xs uppercase tracking-wide text-muted-foreground mt-2">Folders</div>

      {folders.map((f) => (
        <div key={f.id} className="group relative">
          {editingId === f.id ? (
            <div className="px-2 py-1 flex gap-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleRename(f.id); if (e.key === "Escape") setEditingId(null); }}
                autoFocus
                className="h-7 text-sm"
              />
              <Button size="sm" variant="ghost" onClick={() => handleRename(f.id)} className="h-7 px-2">✓</Button>
            </div>
          ) : (
            <button
              onClick={() => onSelect(f.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-accent ${activeFolderId === f.id ? "bg-accent font-medium" : ""}`}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.clipCount}</span>
            </button>
          )}
          <div className="absolute right-2 top-1.5 hidden group-hover:flex gap-1">
            <button onClick={() => { setEditingId(f.id); setEditName(f.name); }} className="text-muted-foreground hover:text-foreground">
              <Pencil className="w-3 h-3" />
            </button>
            <button onClick={() => onDelete(f.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}

      <div className="p-2 mt-auto border-t border-border">
        {adding ? (
          <div className="flex gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setAdding(false); }}
              autoFocus
              placeholder="Folder name"
              className="h-7 text-sm"
            />
            <Button size="sm" variant="ghost" onClick={handleCreate} className="h-7 px-2">✓</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Folder
          </Button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create workspace page**

```tsx
// src/app/dashboard/[productId]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { FolderSidebar, type Folder } from "@/components/broll/folder-sidebar";
import { ClipGrid } from "@/components/broll/clip-grid";

type Clip = {
  id: string; brollName: string; filename: string;
  durationMs: number; indexeddbKey: string; folderId: string;
};

export default function WorkspacePage() {
  const { productId } = useParams<{ productId: string }>();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  async function loadFolders() {
    const res = await fetch(`/api/products/${productId}/folders`);
    const data = await res.json();
    setFolders(data);
  }

  async function loadAllClips() {
    const res = await fetch(`/api/products/${productId}/clips`);
    const data = await res.json();
    setClips(data);
  }

  useEffect(() => {
    loadFolders();
    loadAllClips();
  }, [productId]);

  async function handleCreateFolder(name: string) {
    await fetch(`/api/products/${productId}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  }

  async function handleRenameFolder(id: string, name: string) {
    await fetch(`/api/products/${productId}/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  }

  async function handleDeleteFolder(id: string) {
    if (!confirm("Delete this folder and all its clips?")) return;
    const res = await fetch(`/api/products/${productId}/folders/${id}`, { method: "DELETE" });
    const { deletedClipIds } = await res.json();
    if (deletedClipIds?.length) {
      const { deleteProductClips } = await import("@/lib/clip-storage");
      await deleteProductClips(deletedClipIds);
    }
    if (activeFolderId === id) setActiveFolderId(null);
    await loadFolders();
    await loadAllClips();
  }

  const displayedClips = activeFolderId
    ? clips.filter((c) => c.folderId === activeFolderId)
    : clips;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      <FolderSidebar
        folders={folders}
        activeFolderId={activeFolderId}
        onSelect={setActiveFolderId}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onDelete={handleDeleteFolder}
        totalClipCount={clips.length}
      />
      <main className="flex-1 overflow-y-auto p-4">
        <ClipGrid
          clips={displayedClips}
          productId={productId}
          folders={folders}
          activeFolderId={activeFolderId}
          onClipsChanged={loadAllClips}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Commit (ClipGrid stubbed)**

ClipGrid component is created in Task 12. For now add a stub so this compiles:

```tsx
// src/components/broll/clip-grid.tsx (stub)
export function ClipGrid(props: any) {
  return <div className="text-muted-foreground p-4">Clip grid coming in Task 12</div>;
}
```

```bash
git add src/app/dashboard/[productId]/page.tsx src/components/broll/
git commit -m "feat: add workspace page and folder sidebar"
```

---

## Task 12: Clip grid component

**Files:**
- Modify: `src/components/broll/clip-grid.tsx`

Replaces the stub from Task 11.

- [ ] **Step 1: Create clip-grid.tsx**

```tsx
// src/components/broll/clip-grid.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Trash2, Pencil, MoveRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getThumbnail } from "@/lib/clip-storage";
import { deriveBaseName, isValidBrollName } from "@/lib/broll";
import type { Folder } from "./folder-sidebar";
import { ClipUpload } from "./clip-upload";

type Clip = {
  id: string; brollName: string; filename: string;
  durationMs: number; indexeddbKey: string; folderId: string;
};

interface ClipGridProps {
  clips: Clip[];
  productId: string;
  folders: Folder[];
  activeFolderId: string | null;
  onClipsChanged: () => void;
}

function ThumbnailImage({ clipId }: { clipId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    getThumbnail(clipId).then((buf) => {
      if (buf) setSrc(URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
    });
  }, [clipId]);
  return src
    ? <img src={src} alt="" className="w-full h-full object-cover" />
    : <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">No preview</div>;
}

function formatMs(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ClipGrid({ clips, productId, folders, activeFolderId, onClipsChanged }: ClipGridProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  // Group clips by base name
  const groups = clips.reduce<Record<string, Clip[]>>((acc, clip) => {
    const base = deriveBaseName(clip.brollName);
    if (!acc[base]) acc[base] = [];
    acc[base].push(clip);
    return acc;
  }, {});

  async function handleDelete(clip: Clip) {
    if (!confirm(`Delete ${clip.brollName}?`)) return;
    const res = await fetch(`/api/products/${productId}/clips/${clip.id}`, { method: "DELETE" });
    if (res.ok) {
      const { deleteClip } = await import("@/lib/clip-storage");
      await deleteClip(clip.id);
      onClipsChanged();
    }
  }

  async function handleRename(clip: Clip) {
    if (!isValidBrollName(editName)) {
      alert("Invalid name. Must match pattern: name-01 (lowercase, ends with -NN)");
      return;
    }
    const res = await fetch(`/api/products/${productId}/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brollName: editName }),
    });
    if (res.ok) { setEditingId(null); onClipsChanged(); }
    else { const d = await res.json(); alert(d.error); }
  }

  async function handleMove(clip: Clip, folderId: string) {
    await fetch(`/api/products/${productId}/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    onClipsChanged();
  }

  if (clips.length === 0 && !showUpload) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-4">
        <p>{activeFolderId ? "No clips in this folder." : "No clips yet."}</p>
        {activeFolderId && (
          <Button onClick={() => setShowUpload(true)}><Upload className="w-4 h-4 mr-2" />Upload Clips</Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {activeFolderId && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setShowUpload((v) => !v)}>
            <Upload className="w-4 h-4 mr-2" />{showUpload ? "Hide Upload" : "Upload Clips"}
          </Button>
        </div>
      )}

      {showUpload && activeFolderId && (
        <ClipUpload
          productId={productId}
          folderId={activeFolderId}
          onDone={() => { setShowUpload(false); onClipsChanged(); }}
        />
      )}

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
                  <ThumbnailImage clipId={clip.id} />
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
                        onKeyDown={(e) => { if (e.key === "Enter") handleRename(clip); if (e.key === "Escape") setEditingId(null); }}
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
                  <button onClick={() => { setEditingId(clip.id); setEditName(clip.brollName); }} className="text-white hover:text-yellow-300">
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
}
```

- [ ] **Step 2: Add ClipUpload stub so it compiles**

```tsx
// src/components/broll/clip-upload.tsx (stub)
export function ClipUpload(props: any) {
  return <div className="text-muted-foreground p-4 border rounded">Upload coming in Task 13</div>;
}
```

- [ ] **Step 3: Verify in browser**

Navigate to a product workspace. Folder sidebar and clip grid should render (empty state shown).

- [ ] **Step 4: Commit**

```bash
git add src/components/broll/clip-grid.tsx src/components/broll/clip-upload.tsx
git commit -m "feat: add clip grid component with base-name grouping"
```

---

## Task 13: Clip upload pipeline

**Files:**
- Modify: `src/components/broll/clip-upload.tsx`

This replaces the stub from Task 12.

- [ ] **Step 1: Create clip-upload.tsx**

```tsx
// src/components/broll/clip-upload.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filenameToBrollName, isValidBrollName } from "@/lib/broll";
import { saveClip, saveThumbnail } from "@/lib/clip-storage";
import { loadFFmpeg } from "@/lib/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

interface UploadRow {
  file: File;
  brollName: string;
  status: "ready" | "invalid" | "duplicate" | "uploading" | "done" | "error";
  error?: string;
  progress?: number;
}

interface ClipUploadProps {
  productId: string;
  folderId: string;
  onDone: () => void;
}

export function ClipUpload({ productId, folderId, onDone }: ClipUploadProps) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateRow(index: number, patch: Partial<UploadRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleFiles(files: File[]) {
    const mp4s = files.filter((f) => f.name.toLowerCase().endsWith(".mp4"));
    if (!mp4s.length) return;

    // Fetch existing brollNames to check duplicates
    const res = await fetch(`/api/products/${productId}/clips`);
    const existing: { brollName: string }[] = await res.json();
    const existingNames = new Set(existing.map((c) => c.brollName));

    const newRows: UploadRow[] = mp4s.map((file) => {
      const brollName = filenameToBrollName(file.name);
      let status: UploadRow["status"] = "ready";
      if (!isValidBrollName(brollName)) status = "invalid";
      else if (existingNames.has(brollName)) status = "duplicate";
      return { file, brollName, status };
    });
    setRows((prev) => [...prev, ...newRows]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(Array.from(e.dataTransfer.files));
  }

  async function uploadAll() {
    const readyRows = rows.filter((r) => r.status === "ready");
    if (!readyRows.length) return;
    setUploading(true);

    const ffmpeg = await loadFFmpeg();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== "ready") continue;
      updateRow(i, { status: "uploading", progress: 0 });

      try {
        const inputName = `input-${i}.mp4`;
        const outputName = `output-${i}.mp4`;
        const thumbName = `thumb-${i}.jpg`;

        await ffmpeg.writeFile(inputName, await fetchFile(row.file));
        updateRow(i, { progress: 20 });

        // Transcode to 1080x1350
        await ffmpeg.exec([
          "-i", inputName,
          "-vf", "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2",
          "-c:v", "libx264", "-preset", "fast", "-an",
          outputName,
        ]);
        updateRow(i, { progress: 60 });

        // Extract thumbnail
        await ffmpeg.exec([
          "-i", inputName, "-ss", "00:00:01", "-frames:v", "1", "-f", "image2", thumbName,
        ]);
        updateRow(i, { progress: 70 });

        const videoData = await ffmpeg.readFile(outputName) as Uint8Array;
        const thumbData = await ffmpeg.readFile(thumbName) as Uint8Array;

        // Get duration via ffprobe equivalent (decode first frame metadata)
        // Approximate: use original file duration via HTMLVideoElement
        const duration = await getVideoDurationMs(row.file);

        // Save to IndexedDB
        const clipId = crypto.randomUUID();
        await saveClip(clipId, videoData.buffer);
        await saveThumbnail(clipId, thumbData.buffer);
        updateRow(i, { progress: 85 });

        // Save metadata to Postgres
        const metaRes = await fetch(`/api/products/${productId}/folders/${folderId}/clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brollName: row.brollName,
            filename: row.file.name,
            durationMs: duration,
            width: 1080,
            height: 1350,
            indexeddbKey: clipId,
            fileSizeBytes: videoData.byteLength,
          }),
        });

        if (!metaRes.ok) {
          // Rollback IndexedDB
          const { deleteClip } = await import("@/lib/clip-storage");
          await deleteClip(clipId);
          const err = await metaRes.json();
          updateRow(i, { status: "error", error: err.error });
          continue;
        }

        // Cleanup FFmpeg virtual FS
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
        await ffmpeg.deleteFile(thumbName);

        updateRow(i, { status: "done", progress: 100 });
      } catch (err) {
        updateRow(i, { status: "error", error: String(err) });
      }
    }

    setUploading(false);
    if (rows.every((r, i) => rows[i].status === "done" || rows[i].status === "error")) {
      onDone();
    }
  }

  const readyCount = rows.filter((r) => r.status === "ready").length;

  return (
    <div className="border-2 border-dashed border-border rounded-lg p-4 space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex flex-col items-center gap-2 py-6 cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Drop MP4 files here or click to browse</p>
        <p className="text-xs text-muted-foreground">Files must be named: <code>base-name-01.mp4</code></p>
      </div>
      <input ref={fileInputRef} type="file" multiple accept=".mp4" className="hidden"
        onChange={(e) => handleFiles(Array.from(e.target.files ?? []))} />

      {rows.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-muted/30">
              {row.status === "done" && <Check className="w-4 h-4 text-green-500 shrink-0" />}
              {row.status === "error" && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
              {(row.status === "invalid" || row.status === "duplicate") && (
                <AlertCircle className="w-4 h-4 text-yellow-500 shrink-0" />
              )}
              {(row.status === "ready" || row.status === "uploading") && (
                <div className="w-4 h-4 shrink-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}

              {(row.status === "invalid" || row.status === "duplicate") ? (
                <Input
                  value={row.brollName}
                  onChange={(e) => {
                    const name = e.target.value;
                    const st = !isValidBrollName(name) ? "invalid" : "ready";
                    updateRow(i, { brollName: name, status: st });
                  }}
                  className="h-6 text-xs font-mono flex-1"
                />
              ) : (
                <span className="font-mono flex-1 truncate">{row.brollName}</span>
              )}

              <span className={`text-xs shrink-0 ${
                row.status === "invalid" ? "text-yellow-600" :
                row.status === "duplicate" ? "text-orange-600" :
                row.status === "error" ? "text-red-600" :
                row.status === "done" ? "text-green-600" : "text-muted-foreground"
              }`}>
                {row.status === "uploading" ? `${row.progress ?? 0}%` : row.status}
                {row.error ? `: ${row.error}` : ""}
              </span>

              <button onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>
                <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}

      {readyCount > 0 && (
        <Button onClick={uploadAll} disabled={uploading} className="w-full">
          {uploading ? "Uploading…" : `Upload ${readyCount} valid file${readyCount !== 1 ? "s" : ""}`}
        </Button>
      )}
    </div>
  );
}

async function getVideoDurationMs(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Math.round(video.duration * 1000));
    };
    video.src = URL.createObjectURL(file);
  });
}
```

- [ ] **Step 2: Test upload flow in Chrome**

1. Navigate to a product workspace.
2. Create a folder called "Test".
3. Select that folder, click "Upload Clips".
4. Drop a file named `hook-01.mp4` — should show "ready".
5. Drop a file named `Hook.mp4` — should show "invalid" with rename input.
6. Fix the invalid name to `hook-02.mp4` — status should change to "ready".
7. Click Upload — verify progress updates, clip appears in grid after done.

- [ ] **Step 3: Commit**

```bash
git add src/components/broll/clip-upload.tsx
git commit -m "feat: add bulk clip upload pipeline with staging and FFmpeg transcoding"
```

---

## Task 14: Script parser (TDD)

**Files:**
- Create: `src/lib/script-parser.ts`
- Create: `src/lib/__tests__/script-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/script-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseScript } from "../script-parser";

const BASE_NAMES = new Set(["hook", "fs-clipper-freakout", "ump-compressthenail", "before-after"]);

describe("parseScript", () => {
  it("parses valid HH:MM:SS line", () => {
    const result = parseScript("00:00:00 - 00:00:04 || Hook || Intro text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({
      startTime: 0,
      endTime: 4,
      tag: "Hook",
      scriptText: "Intro text",
      durationMs: 4000,
    });
  });

  it("parses MM:SS shorthand", () => {
    const result = parseScript("00:00 - 00:04 || Hook || text", BASE_NAMES);
    expect(result.errors).toHaveLength(0);
    expect(result.sections[0].startTime).toBe(0);
    expect(result.sections[0].endTime).toBe(4);
  });

  it("skips blank lines", () => {
    const result = parseScript("\n00:00 - 00:04 || Hook || text\n\n", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
  });

  it("errors on invalid line", () => {
    const result = parseScript("not a valid line", BASE_NAMES);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
  });

  it("warns on unknown tag (case-insensitive)", () => {
    const result = parseScript("00:00 - 00:04 || UnknownTag || text", BASE_NAMES);
    expect(result.sections).toHaveLength(1);
    expect(result.warnings.some((w) => w.message.includes("UnknownTag"))).toBe(true);
  });

  it("matches tags case-insensitively", () => {
    const result = parseScript("00:00 - 00:04 || FS-CLIPPER-FREAKOUT || text", BASE_NAMES);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on zero-duration section", () => {
    const result = parseScript("00:00 - 00:00 || Hook || text", BASE_NAMES);
    expect(result.warnings.some((w) => w.message.includes("zero"))).toBe(true);
  });

  it("handles multi-line script", () => {
    const input = [
      "00:00 - 00:04 || Hook || Line one",
      "00:04 - 00:10 || FS-clipper-freakout || Line two",
    ].join("\n");
    const result = parseScript(input, BASE_NAMES);
    expect(result.sections).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm test
```

Expected: module not found errors.

- [ ] **Step 3: Implement script-parser.ts**

```ts
// src/lib/script-parser.ts

export interface ParsedSection {
  lineNumber: number;
  startTime: number;   // seconds
  endTime: number;     // seconds
  tag: string;         // original (trimmed)
  scriptText: string;
  durationMs: number;
}

export interface ParseResult {
  sections: ParsedSection[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}

const LINE_PATTERN =
  /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\|\|\s*(.+?)\s*\|\|\s*(.*)$/;

function parseTime(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function parseScript(text: string, availableBaseNames: Set<string>): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: { line: number; message: string }[] = [];

  const lines = text.split("\n");
  lines.forEach((raw, idx) => {
    const lineNumber = idx + 1;
    const line = raw.trim();
    if (!line) return;

    const match = line.match(LINE_PATTERN);
    if (!match) {
      errors.push({ line: lineNumber, message: `Invalid format at line ${lineNumber}` });
      return;
    }

    const [, startStr, endStr, tag, scriptText] = match;
    const startTime = parseTime(startStr);
    const endTime = parseTime(endStr);
    const durationMs = (endTime - startTime) * 1000;

    if (durationMs === 0) {
      warnings.push({ line: lineNumber, message: `Line ${lineNumber}: zero-duration section for tag "${tag}"` });
    }

    if (!availableBaseNames.has(tag.toLowerCase())) {
      warnings.push({
        line: lineNumber,
        message: `Line ${lineNumber}: tag "${tag}" has no matching B-roll base name. Will render black frames.`,
      });
    }

    sections.push({ lineNumber, startTime, endTime, tag, scriptText: scriptText.trim(), durationMs });
  });

  return { sections, errors, warnings };
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
pnpm test
```

Expected: all script-parser tests pass (11 total with broll tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/script-parser.ts src/lib/__tests__/script-parser.test.ts
git commit -m "feat: add script parser with base-name validation and TDD tests"
```

---

## Task 15: Auto-match engine (TDD)

**Files:**
- Create: `src/lib/auto-match.ts`
- Create: `src/lib/__tests__/auto-match.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/auto-match.test.ts
import { describe, it, expect } from "vitest";
import { buildClipsByBaseName, matchSections } from "../auto-match";
import type { ParsedSection } from "../script-parser";

const makeClip = (brollName: string, durationMs: number) => ({
  id: brollName,
  brollName,
  baseName: brollName.replace(/-\d+$/, ""),
  durationMs,
  indexeddbKey: brollName,
  folderId: "f1",
  productId: "p1",
  filename: `${brollName}.mp4`,
  width: 1080,
  height: 1350,
  fileSizeBytes: 1000,
  createdAt: new Date(),
});

const makeSection = (tag: string, durationMs: number): ParsedSection => ({
  lineNumber: 1,
  startTime: 0,
  endTime: durationMs / 1000,
  tag,
  scriptText: "text",
  durationMs,
});

describe("buildClipsByBaseName", () => {
  it("groups variants by base name", () => {
    const clips = [
      makeClip("hook-01", 5000),
      makeClip("hook-02", 6000),
      makeClip("outro-01", 4000),
    ];
    const map = buildClipsByBaseName(clips);
    expect(map.get("hook")).toHaveLength(2);
    expect(map.get("outro")).toHaveLength(1);
  });
});

describe("matchSections", () => {
  it("Scenario A: section shorter than clip — speeds up", () => {
    const clips = [makeClip("hook-01", 8000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 4000)], map);
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0].speedFactor).toBeCloseTo(2.0, 1);
    expect(matched.clips[0].isPlaceholder).toBe(false);
  });

  it("Scenario A: speed > 2x — trims", () => {
    const clips = [makeClip("hook-01", 20000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 4000)], map);
    expect(matched.clips[0].speedFactor).toBe(2.0);
    expect(matched.clips[0].trimDurationMs).toBe(8000); // 4000 * 2
  });

  it("Scenario B: section longer than clip — chains", () => {
    const clips = [makeClip("hook-01", 3000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 7000)], map);
    expect(matched.clips.length).toBeGreaterThanOrEqual(2);
  });

  it("no matching base name — placeholder", () => {
    const [matched] = matchSections([makeSection("unknown-tag", 4000)], new Map());
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0].isPlaceholder).toBe(true);
    expect(matched.warnings.some((w) => w.includes("No B-roll"))).toBe(true);
  });

  it("zero-duration section — empty clips", () => {
    const clips = [makeClip("hook-01", 5000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 0)], map);
    expect(matched.clips).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
pnpm test
```

Expected: module not found.

- [ ] **Step 3: Implement auto-match.ts**

```ts
// src/lib/auto-match.ts
import { deriveBaseName } from "./broll";
import type { ParsedSection } from "./script-parser";

export interface ClipMetadata {
  id: string;
  brollName: string;
  baseName: string;
  durationMs: number;
  indexeddbKey: string;
  folderId: string;
  productId: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: Date;
}

export interface MatchedClip {
  clipId: string;
  indexeddbKey: string;
  speedFactor: number;
  trimDurationMs?: number;
  isPlaceholder: boolean;
}

export interface MatchedSection {
  sectionIndex: number;
  tag: string;
  durationMs: number;
  clips: MatchedClip[];
  warnings: string[];
}

export function buildClipsByBaseName(clips: ClipMetadata[]): Map<string, ClipMetadata[]> {
  const map = new Map<string, ClipMetadata[]>();
  for (const clip of clips) {
    const key = deriveBaseName(clip.brollName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(clip);
  }
  return map;
}

function pickRandom<T>(arr: T[], avoid?: T): T {
  if (arr.length === 1) return arr[0];
  const choices = avoid ? arr.filter((x) => x !== avoid) : arr;
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : arr[0];
}

function scenarioA(clip: ClipMetadata, sectionMs: number): MatchedClip {
  const speedFactor = clip.durationMs / sectionMs;
  if (speedFactor <= 2.0) {
    return { clipId: clip.id, indexeddbKey: clip.indexeddbKey, speedFactor, isPlaceholder: false };
  }
  return {
    clipId: clip.id,
    indexeddbKey: clip.indexeddbKey,
    speedFactor: 2.0,
    trimDurationMs: sectionMs * 2,
    isPlaceholder: false,
  };
}

export function matchSections(
  sections: ParsedSection[],
  clipsByBaseName: Map<string, ClipMetadata[]>,
): MatchedSection[] {
  return sections.map((section, sectionIndex) => {
    const warnings: string[] = [];

    if (section.durationMs === 0) {
      return { sectionIndex, tag: section.tag, durationMs: 0, clips: [], warnings };
    }

    const key = section.tag.toLowerCase();
    const candidates = clipsByBaseName.get(key) ?? [];

    if (candidates.length === 0) {
      warnings.push(`No B-roll found for tag: ${section.tag}`);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1.0, isPlaceholder: true }],
        warnings,
      };
    }

    // Scenario A: section fits in one clip
    if (section.durationMs <= candidates[0].durationMs || candidates.length === 0) {
      const clip = pickRandom(candidates);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [scenarioA(clip, section.durationMs)],
        warnings,
      };
    }

    // Scenario B: chain clips
    const matched: MatchedClip[] = [];
    let remaining = section.durationMs;
    let lastClip: ClipMetadata | undefined;

    while (remaining > 0) {
      const clip = pickRandom(candidates, lastClip);
      lastClip = clip;

      if (clip.durationMs <= remaining) {
        matched.push({ clipId: clip.id, indexeddbKey: clip.indexeddbKey, speedFactor: 1.0, isPlaceholder: false });
        remaining -= clip.durationMs;
      } else {
        matched.push(scenarioA(clip, remaining));
        remaining = 0;
      }
    }

    return { sectionIndex, tag: section.tag, durationMs: section.durationMs, clips: matched, warnings };
  });
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
pnpm test
```

Expected: all tests pass (broll + script-parser + auto-match).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat: add auto-match engine with base-name lookup and TDD tests"
```

---

## Task 16: Build Video page + Step wrappers

**Files:**
- Create: `src/app/dashboard/[productId]/build/page.tsx`
- Create: `src/components/build/step-wrapper.tsx`

- [ ] **Step 1: Create step-wrapper.tsx**

```tsx
// src/components/build/step-wrapper.tsx
import { cn } from "@/lib/utils";

interface StepWrapperProps {
  step: number;
  title: string;
  active: boolean;
  waitingFor?: string;
  children: React.ReactNode;
}

export function StepWrapper({ step, title, active, waitingFor, children }: StepWrapperProps) {
  return (
    <section className={cn("border border-border rounded-xl p-6 transition-opacity", !active && "opacity-40 pointer-events-none")}>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
          {step}
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        {!active && waitingFor && (
          <span className="ml-auto text-xs text-muted-foreground uppercase tracking-wide">
            Waiting for {waitingFor}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Create build/page.tsx**

```tsx
// src/app/dashboard/[productId]/build/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { StepWrapper } from "@/components/build/step-wrapper";
import { AudioUpload } from "@/components/build/audio-upload";
import { ScriptPaste } from "@/components/build/script-paste";
import { TimelinePreview } from "@/components/build/timeline-preview";
import { RenderTrigger } from "@/components/build/render-trigger";
import type { ParsedSection } from "@/lib/script-parser";
import type { MatchedSection } from "@/lib/auto-match";

export default function BuildVideoPage() {
  const { productId } = useParams<{ productId: string }>();
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sections, setSections] = useState<ParsedSection[] | null>(null);
  const [timeline, setTimeline] = useState<MatchedSection[] | null>(null);
  const [availableBaseNames, setAvailableBaseNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/products/${productId}/clips`).then((r) => r.json()).then((clips) => {
      const { deriveBaseName } = require("@/lib/broll");
      const names = new Set<string>(clips.map((c: any) => deriveBaseName(c.brollName)));
      setAvailableBaseNames(names);
    });
  }, [productId]);

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <h1 className="text-2xl font-bold">Build Video</h1>

      <StepWrapper step={1} title="Upload Audio" active>
        <AudioUpload onAudioReady={setAudioFile} />
      </StepWrapper>

      <StepWrapper step={2} title="Paste Script" active>
        <ScriptPaste
          availableBaseNames={availableBaseNames}
          productId={productId}
          onParsed={(s, t) => { setSections(s); setTimeline(t); }}
        />
      </StepWrapper>

      <StepWrapper step={3} title="Review Timeline" active={!!sections} waitingFor="Script">
        {timeline && (
          <TimelinePreview
            timeline={timeline}
            productId={productId}
            onTimelineChange={setTimeline}
          />
        )}
      </StepWrapper>

      <StepWrapper step={4} title="Render Video" active={!!audioFile && !!timeline} waitingFor="Audio + Timeline">
        {audioFile && timeline && (
          <RenderTrigger audioFile={audioFile} timeline={timeline} />
        )}
      </StepWrapper>
    </div>
  );
}
```

- [ ] **Step 3: Add stubs for remaining build components**

```tsx
// src/components/build/audio-upload.tsx (stub)
export function AudioUpload({ onAudioReady }: { onAudioReady: (f: File) => void }) {
  return <div className="text-muted-foreground">Audio upload — Task 17</div>;
}

// src/components/build/script-paste.tsx (stub)
export function ScriptPaste(props: any) {
  return <div className="text-muted-foreground">Script paste — Task 18</div>;
}

// src/components/build/timeline-preview.tsx (stub)
export function TimelinePreview(props: any) {
  return <div className="text-muted-foreground">Timeline — Task 19</div>;
}

// src/components/build/render-trigger.tsx (stub)
export function RenderTrigger(props: any) {
  return <div className="text-muted-foreground">Render — Task 20</div>;
}
```

- [ ] **Step 4: Add "Build Video" tab link to workspace page**

In `src/app/dashboard/[productId]/page.tsx`, add a tab bar above the main content:

```tsx
import Link from "next/link";
// at top of return JSX, before the flex div:
<div className="border-b border-border px-4 flex gap-4">
  <Link href={`/dashboard/${productId}`} className="py-3 text-sm font-medium border-b-2 border-primary">Library</Link>
  <Link href={`/dashboard/${productId}/build`} className="py-3 text-sm font-medium text-muted-foreground hover:text-foreground">Build Video</Link>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/[productId]/build/ src/components/build/ src/components/build/step-wrapper.tsx
git commit -m "feat: add Build Video page scaffold with step wrappers"
```

---

## Task 17: Audio upload step

**Files:**
- Modify: `src/components/build/audio-upload.tsx`

- [ ] **Step 1: Implement audio-upload.tsx**

```tsx
// src/components/build/audio-upload.tsx
"use client";

import { useState, useRef } from "react";
import { Music, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AudioUploadProps {
  onAudioReady: (file: File) => void;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioUpload({ onAudioReady }: AudioUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".mp3")) {
      alert("Only MP3 files are supported.");
      return;
    }
    const audio = new Audio(URL.createObjectURL(f));
    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    setFile(f);
    onAudioReady(f);
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
        <Music className="w-5 h-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          {duration !== null && <p className="text-xs text-muted-foreground">{formatDuration(duration)}</p>}
        </div>
        <button onClick={() => { setFile(null); setDuration(null); }} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center gap-3 cursor-pointer hover:bg-muted/20"
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
    >
      <Music className="w-8 h-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Drop MP3 here or click to browse</p>
      <input ref={inputRef} type="file" accept=".mp3" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/build/audio-upload.tsx
git commit -m "feat: add audio upload step with duration display"
```

---

## Task 18: Script paste step

**Files:**
- Modify: `src/components/build/script-paste.tsx`

- [ ] **Step 1: Implement script-paste.tsx**

```tsx
// src/components/build/script-paste.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseScript, type ParsedSection } from "@/lib/script-parser";
import { buildClipsByBaseName, matchSections, type MatchedSection, type ClipMetadata } from "@/lib/auto-match";
import { deriveBaseName } from "@/lib/broll";

interface ScriptPasteProps {
  availableBaseNames: Set<string>;
  productId: string;
  onParsed: (sections: ParsedSection[], timeline: MatchedSection[]) => void;
}

export function ScriptPaste({ availableBaseNames, productId, onParsed }: ScriptPasteProps) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [warnings, setWarnings] = useState<{ line: number; message: string }[]>([]);
  const [parsed, setParsed] = useState(false);

  async function handleParse() {
    const result = parseScript(text, availableBaseNames);
    setErrors(result.errors);
    setWarnings(result.warnings);

    if (result.errors.length > 0) return;

    // Fetch all clips and build auto-match map
    const clipsRes = await fetch(`/api/products/${productId}/clips`);
    const rawClips = await clipsRes.json();
    const clips: ClipMetadata[] = rawClips.map((c: any) => ({
      ...c,
      baseName: deriveBaseName(c.brollName),
      createdAt: new Date(c.createdAt),
    }));
    const clipsByBaseName = buildClipsByBaseName(clips);
    const timeline = matchSections(result.sections, clipsByBaseName);

    setParsed(true);
    onParsed(result.sections, timeline);
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setParsed(false); }}
        className="w-full h-48 font-mono text-sm border border-border rounded-lg p-3 bg-background resize-y focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={"00:00 - 00:04 || hook || Script text here\n00:04 - 00:12 || fs-clipper-freakout || More script"}
      />

      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-sm text-destructive">Line {e.line}: {e.message}</p>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-yellow-600">⚠ Line {w.line}: {w.message}</p>
          ))}
        </div>
      )}

      <Button onClick={handleParse} disabled={!text.trim()}>
        {parsed ? "Re-parse" : "Parse Script"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/build/script-paste.tsx
git commit -m "feat: add script paste step with parser and auto-match wiring"
```

---

## Task 19: Timeline preview + missing-matches panel

**Files:**
- Modify: `src/components/build/timeline-preview.tsx`

- [ ] **Step 1: Implement timeline-preview.tsx**

```tsx
// src/components/build/timeline-preview.tsx
"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getThumbnail } from "@/lib/clip-storage";
import { buildClipsByBaseName, matchSections, type MatchedSection, type ClipMetadata } from "@/lib/auto-match";
import { deriveBaseName } from "@/lib/broll";
import type { ParsedSection } from "@/lib/script-parser";

interface TimelinePreviewProps {
  timeline: MatchedSection[];
  productId: string;
  onTimelineChange: (t: MatchedSection[]) => void;
}

function formatMs(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function MissingPanel({ timeline }: { timeline: MatchedSection[] }) {
  const missing = timeline
    .filter((s) => s.clips.some((c) => c.isPlaceholder))
    .reduce<Record<string, { count: number; totalMs: number }>>((acc, s) => {
      const key = s.tag;
      if (!acc[key]) acc[key] = { count: 0, totalMs: 0 };
      acc[key].count++;
      acc[key].totalMs += s.durationMs;
      return acc;
    }, {});

  if (Object.keys(missing).length === 0) return null;

  return (
    <div className="border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-4 text-sm">
      <p className="font-medium text-yellow-800 dark:text-yellow-300 mb-2">
        ⚠ {Object.keys(missing).length} tag{Object.keys(missing).length !== 1 ? "s" : ""} without B-roll matches (will render as black frames):
      </p>
      <ul className="space-y-0.5 text-yellow-700 dark:text-yellow-400">
        {Object.entries(missing).map(([tag, { count, totalMs }]) => (
          <li key={tag} className="font-mono text-xs">
            {tag} — {count} section{count !== 1 ? "s" : ""}, {formatMs(totalMs)} total
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimelinePreview({ timeline, productId, onTimelineChange }: TimelinePreviewProps) {
  async function reroll(sectionIndex: number) {
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
    const newTimeline = timeline.map((s, i) => (i === sectionIndex ? rerolled : s));
    onTimelineChange(newTimeline);
  }

  return (
    <div className="space-y-4">
      <MissingPanel timeline={timeline} />

      <div className="space-y-2">
        {timeline.map((section, i) => (
          <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg">
            <span className="text-xs font-mono w-6 text-muted-foreground">{i + 1}</span>
            <span className="text-xs font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">
              {section.tag}
            </span>
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
        ))}
      </div>
    </div>
  );
}

function ClipThumb({ clipId }: { clipId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useState(() => {
    getThumbnail(clipId).then((buf) => {
      if (buf) setSrc(URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
    });
  });
  return src ? <img src={src} alt="" className="w-full h-full object-cover" /> : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/build/timeline-preview.tsx
git commit -m "feat: add timeline preview with missing-matches panel and re-roll"
```

---

## Task 20: Render trigger + Video renderer

**Files:**
- Modify: `src/components/build/render-trigger.tsx`
- Create: `src/workers/render-worker.ts`

- [ ] **Step 1: Create render worker**

```ts
// src/workers/render-worker.ts
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

self.onmessage = async (e: MessageEvent) => {
  const { timeline, audioBuffer, clips } = e.data;
  // clips: Record<indexeddbKey, ArrayBuffer>

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  const totalSections = timeline.length;
  const segmentPaths: string[] = [];

  for (let i = 0; i < timeline.length; i++) {
    const section = timeline[i];
    self.postMessage({ type: "progress", currentSection: i + 1, totalSections });

    for (let j = 0; j < section.clips.length; j++) {
      const matched = section.clips[j];
      const segName = `seg-${i}-${j}.mp4`;

      if (matched.isPlaceholder) {
        await ffmpeg.exec([
          "-f", "lavfi",
          "-i", `color=c=black:s=1080x1350:d=${section.durationMs / 1000}`,
          "-c:v", "libx264",
          segName,
        ]);
      } else {
        const clipBuf = clips[matched.indexeddbKey] as ArrayBuffer;
        await ffmpeg.writeFile(`input-${i}-${j}.mp4`, new Uint8Array(clipBuf));

        const filters: string[] = [];
        if (matched.trimDurationMs) filters.push(`-t ${matched.trimDurationMs / 1000}`);

        await ffmpeg.exec([
          "-i", `input-${i}-${j}.mp4`,
          ...(matched.trimDurationMs ? ["-t", String(matched.trimDurationMs / 1000)] : []),
          "-vf", `setpts=${(1 / matched.speedFactor).toFixed(4)}*PTS`,
          "-an",
          segName,
        ]);
        await ffmpeg.deleteFile(`input-${i}-${j}.mp4`);
      }

      segmentPaths.push(segName);
    }
  }

  // Write concat file
  const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
  await ffmpeg.writeFile("concat.txt", concatContent);

  // Write audio
  await ffmpeg.writeFile("audio.mp3", new Uint8Array(audioBuffer));

  // Render final
  await ffmpeg.exec([
    "-f", "concat", "-safe", "0", "-i", "concat.txt",
    "-i", "audio.mp3",
    "-c:v", "copy", "-c:a", "aac", "-shortest",
    "output.mp4",
  ]);

  const output = await ffmpeg.readFile("output.mp4") as Uint8Array;
  self.postMessage({ type: "done", output: output.buffer }, [output.buffer]);
};
```

- [ ] **Step 2: Implement render-trigger.tsx**

```tsx
// src/components/build/render-trigger.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getClip } from "@/lib/clip-storage";
import type { MatchedSection } from "@/lib/auto-match";

interface RenderTriggerProps {
  audioFile: File;
  timeline: MatchedSection[];
}

export function RenderTrigger({ audioFile, timeline }: RenderTriggerProps) {
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [rendering, setRendering] = useState(false);

  async function startRender() {
    setRendering(true);

    // Load all unique clip binaries
    const keys = new Set(
      timeline.flatMap((s) => s.clips.filter((c) => !c.isPlaceholder).map((c) => c.indexeddbKey)),
    );
    const clips: Record<string, ArrayBuffer> = {};
    for (const key of keys) {
      const buf = await getClip(key);
      if (buf) clips[key] = buf;
    }

    const audioBuffer = await audioFile.arrayBuffer();

    const worker = new Worker(new URL("@/workers/render-worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (e) => {
      if (e.data.type === "progress") {
        setProgress({ current: e.data.currentSection, total: e.data.totalSections });
      } else if (e.data.type === "done") {
        const blob = new Blob([e.data.output], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vsl-${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
        setRendering(false);
        setProgress(null);
        worker.terminate();
      }
    };

    worker.postMessage({ timeline, audioBuffer, clips }, [
      audioBuffer,
      ...Object.values(clips),
    ]);
  }

  return (
    <div className="space-y-3">
      {progress && (
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Section {progress.current} of {progress.total}
          </p>
        </div>
      )}
      <Button onClick={startRender} disabled={rendering} className="w-full" size="lg">
        {rendering ? "Rendering…" : "Render Video"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Configure Next.js for Web Worker**

In `next.config.ts`, add webpack config for worker:

```ts
webpack(config) {
  config.module.rules.push({
    test: /\.worker\.ts$/,
    use: { loader: "worker-loader" },
  });
  return config;
},
```

Actually Next.js 16 with Turbopack handles `new Worker(new URL(...))` natively — no extra webpack config needed.

- [ ] **Step 4: End-to-end test in Chrome**

1. Upload at least 2 clips to a product.
2. Go to Build Video tab.
3. Upload an MP3.
4. Paste a script with 3 sections that match uploaded clip base names.
5. Parse script — verify timeline appears with thumbnails.
6. Click "Render Video" — verify progress bar and auto-download.

- [ ] **Step 5: Commit**

```bash
git add src/components/build/render-trigger.tsx src/workers/render-worker.ts
git commit -m "feat: add video render worker and render trigger with progress"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec requirement | Task |
|-----------------|------|
| B-roll naming convention `^[a-z0-9-]+-\d+$` | Task 3 |
| Schema: folders (rename tags), clips with brollName | Task 4 |
| No default folders on new product | Task 7 |
| Folder CRUD API | Task 8 |
| Clips CRUD + PATCH rename/move + product-wide GET | Task 9 |
| Dashboard product grid | Task 10 |
| Workspace + folder sidebar | Task 11 |
| Clip grid grouped by base name | Task 12 |
| Bulk upload staging + validate + rename + transcode | Task 13 |
| Script parser: warn on missing base names | Task 14 |
| Auto-match: baseName key, Scenario A/B, placeholder | Task 15 |
| Build Video 4-step page | Task 16 |
| Audio upload step | Task 17 |
| Script paste + auto-match wiring | Task 18 |
| Timeline preview + missing-matches panel + re-roll | Task 19 |
| Render worker + progress + auto-download | Task 20 |
| COOP/COEP headers | Task 2 |
| IndexedDB wrapper | Task 5 |
| FFmpeg singleton | Task 6 |

**Gaps identified and addressed:** None.

**Type consistency:** `ClipMetadata.baseName` added in Task 15 and used in Tasks 18 and 19 via `deriveBaseName`. `MatchedSection` flows from Task 15 through Tasks 18, 19, 20. `ParsedSection` defined in Task 14, used in Tasks 15, 16, 18.

**Placeholder scan:** No TBD/TODO. Stubs in Tasks 11/12/16 are explicitly labeled as stubs replaced by later tasks.
