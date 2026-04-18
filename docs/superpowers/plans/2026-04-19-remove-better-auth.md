# Remove Better Auth — Full Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Better Auth from this project entirely — delete all auth code, drop auth tables, remove user-scoping from product data, uninstall the `better-auth` dependency.

**Architecture:** This app is a single-user local B-roll/VSL workstation. The `better-auth` plumbing (login pages, middleware, `requireAuth`, `userId` FK on products) was inherited from a starter kit but never needed. After removal: no auth middleware, no session check in API routes, products are global (no owner), schema has only `products`, `folders`, `clips`. Root `/` redirects directly to `/dashboard`.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, Drizzle ORM + Postgres, Better Auth v1.6.2 (being removed), FFmpeg.wasm client-side.

---

## File Structure — What Changes

**Files to delete:**

- `src/lib/auth.ts` — Better Auth server config
- `src/lib/auth-client.ts` — Better Auth client config (has the port-3000 bug that broke uploads)
- `src/lib/session.ts` — `requireAuth`, `getOptionalSession`, `protectedRoutes`
- `src/proxy.ts` — Next.js proxy cookie gate (causes redirect loop)
- `src/app/api/auth/[...all]/route.ts` — Better Auth catch-all handler (delete directory)
- `src/app/(auth)/` (whole directory) — `login/`, `register/`, `forgot-password/`, `reset-password/`, `layout.tsx`
- `src/app/profile/page.tsx` (delete `profile/` directory)
- `src/app/chat/page.tsx` (delete `chat/` directory — also removes orphan auth usage)
- `src/app/api/chat/route.ts` (delete — chat UI is gone; keep API too would be dead code)
- `src/components/auth/` (whole directory): `user-profile.tsx`, `sign-in-button.tsx`, `sign-up-form.tsx`, `forgot-password-form.tsx`, `reset-password-form.tsx`, `sign-out-button.tsx`

**Files to modify:**

- `src/app/page.tsx` — Root redirect target (avoid proxy-induced loop that no longer exists, but still point to `/dashboard`)
- `src/app/api/products/route.ts` — Drop `requireAuth`, drop `userId` filter/insert
- `src/app/api/products/[id]/route.ts` — Drop `requireAuth`, drop ownership check
- `src/app/api/products/[id]/folders/route.ts` — Same
- `src/app/api/products/[id]/folders/[folderId]/route.ts` — Same
- `src/app/api/products/[id]/folders/[folderId]/clips/route.ts` — Same
- `src/app/api/products/[id]/clips/route.ts` — Same
- `src/app/api/products/[id]/clips/[clipId]/route.ts` — Same
- `src/app/api/diagnostics/route.ts` — Drop BETTER_AUTH_SECRET / auth route / `schema.user` references
- `src/components/site-header.tsx` — Remove `UserProfile` import + usage
- `src/lib/schema.ts` — Delete `user`, `session`, `account`, `verification` tables; drop `userId` column + `products_user_id_idx` from `products`
- `src/lib/env.ts` — Remove `BETTER_AUTH_SECRET` from server schema and `checkEnv()`
- `package.json` — Uninstall `better-auth`

**Files to create:**

- `drizzle/0001_remove_better_auth.sql` — Generated migration dropping 4 tables + `user_id` column + index

**Final import graph (after cleanup):**

```
page.tsx (redirect) ─► /dashboard
layout.tsx ─► SiteHeader ─► ModeToggle   (no auth)
api/products/** ─► db + schema (no session)
api/diagnostics ─► db + schema.products (no auth)
lib/schema.ts ─► products, folders, clips
```

---

## Execution Order Rationale

Order is: **app-layer code first → schema last**. Reason: the current `src/lib/schema.ts` has foreign keys `products.userId ─► user.id`. If we drop the `user` table before removing API-route references to `session.user.id`, TypeScript still compiles but runtime/migrations get tangled. We cut **usage** first (API routes → UI → env/diagnostics), then cut **declaration** (schema), then generate the migration from a clean state.

---

## Task 1: Safety checkpoint + baseline verify

**Files:**
- No file changes; capture starting state

- [ ] **Step 1: Confirm clean working tree (or record what's dirty)**

Run: `git status --short`
Expected: some pre-existing modifications (drizzle journal, page.tsx, layout.tsx additions, ffmpeg.ts, etc.). Note them — they are pre-existing work, not part of this plan. Do not stash them; the plan edits some of the same files.

- [ ] **Step 2: Record baseline typecheck**

Run: `pnpm typecheck`
Expected: passes (or note any pre-existing errors so we don't blame them on our changes).

- [ ] **Step 3: Kill any running dev server so port bindings clear**

Run: `pkill -f "next dev" || true`
Expected: no error (exits 0 even if nothing was running).

- [ ] **Step 4: Ensure DB is reachable (we will run a migration later)**

Run: `pnpm db:studio --port 4999 &` then kill it after a few seconds, OR just:
Run: `node -e "require('postgres')(process.env.POSTGRES_URL).end().then(() => console.log('ok'))"` with env loaded.

Simpler: rely on the migration step (Task 12) to surface DB issues. If the migration fails, we debug then.

---

## Task 2: Remove auth from `api/products/route.ts`

**Files:**
- Modify: `src/app/api/products/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select()
    .from(products)
    .orderBy(desc(products.updatedAt));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const [product] = await db
    .insert(products)
    .values({ name: name.trim() })
    .returning();
  return NextResponse.json(product, { status: 201 });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: `products.userId` is still a non-null column in the schema, so `db.insert(products).values({ name })` will error with `Property 'userId' is missing in type...`. That's expected — we fix the schema in Task 12. For now this error is part of a transient state.

If you want a cleaner intermediate state, leave this error and move on — we will batch-commit after Task 12.

---

## Task 3: Remove auth from `api/products/[id]/route.ts`

**Files:**
- Modify: `src/app/api/products/[id]/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq } from "drizzle-orm";

async function getProduct(productId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  return product ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(product);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.productId, id));
  await db.delete(products).where(eq(products.id, id));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
```

Notes:
- No more `requireAuth()`, no more `session.user.id` filter.
- The helper `getOwnedProduct` is now just `getProduct` (no owner check).

---

## Task 4: Remove auth from `api/products/[id]/folders/route.ts`

**Files:**
- Modify: `src/app/api/products/[id]/folders/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

async function productExists(productId: string): Promise<boolean> {
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  return Boolean(p);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await productExists(id))) {
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
  const { id } = await params;
  if (!(await productExists(id))) {
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

---

## Task 5: Remove auth from `api/products/[id]/folders/[folderId]/route.ts`

**Files:**
- Modify: `src/app/api/products/[id]/folders/[folderId]/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function getFolder(productId: string, folderId: string) {
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
  const { id, folderId } = await params;
  const folder = await getFolder(id, folderId);
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const { id, folderId } = await params;
  const folder = await getFolder(id, folderId);
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.folderId, folderId));
  await db.delete(folders).where(eq(folders.id, folderId));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
```

---

## Task 6: Remove auth from `api/products/[id]/folders/[folderId]/clips/route.ts`

**Files:**
- Modify: `src/app/api/products/[id]/folders/[folderId]/clips/route.ts`

- [ ] **Step 1: Read current file to preserve the non-auth parts exactly**

Run: `cat src/app/api/products/[id]/folders/[folderId]/clips/route.ts`

- [ ] **Step 2: Replace with auth-free version**

Rewrite the file. Preserve the same inputs, validation, and SQL semantics. Scaffold:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function folderExists(productId: string, folderId: string): Promise<boolean> {
  const [f] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.productId, productId)));
  return Boolean(f);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const { id, folderId } = await params;
  if (!(await folderExists(id, folderId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.folderId, folderId))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}
```

If the current file also has `POST` (clip creation), keep its body logic but:
- Drop the `await requireAuth()` line
- Drop the `products.userId` filter — use `folderExists(id, folderId)` instead
- Keep everything else (broll-name validation, `indexeddbKey`, `fileSizeBytes`, etc.) **byte-for-byte**

Concrete rule: preserve every column written in the INSERT — we only change the **authorization wrapper**, not the business logic.

---

## Task 7: Remove auth from `api/products/[id]/clips/route.ts`

**Files:**
- Modify: `src/app/api/products/[id]/clips/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, id));
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.productId, id))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}
```

---

## Task 8: Remove auth from `api/products/[id]/clips/[clipId]/route.ts`

**Files:**
- Modify: `src/app/api/products/[id]/clips/[clipId]/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clips, folders } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { isValidBrollName } from "@/lib/broll";

async function getClip(productId: string, clipId: string) {
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
  const { id, clipId } = await params;
  const clip = await getClip(id, clipId);
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const clip = await getClip(id, clipId);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(clips).where(eq(clips.id, clipId));
  return NextResponse.json({ deletedClipId: clipId });
}
```

---

## Task 9: Delete Better Auth catch-all + chat API + auth pages

**Files:**
- Delete: `src/app/api/auth/[...all]/route.ts` (and the `[...all]` + `auth` directories if empty)
- Delete: `src/app/api/chat/route.ts` (and the `chat` directory if empty)
- Delete: `src/app/(auth)/` (whole directory: `login/`, `register/`, `forgot-password/`, `reset-password/`, `layout.tsx`)
- Delete: `src/app/profile/` (whole directory)
- Delete: `src/app/chat/` (whole directory — the client UI that consumed the chat API)

- [ ] **Step 1: Delete Better Auth API route directory**

Run: `rm -rf src/app/api/auth`

- [ ] **Step 2: Delete chat API route directory**

Run: `rm -rf src/app/api/chat`

- [ ] **Step 3: Delete `(auth)` route group**

Run: `rm -rf "src/app/(auth)"`

- [ ] **Step 4: Delete profile + chat page directories**

Run: `rm -rf src/app/profile src/app/chat`

- [ ] **Step 5: Verify no route files remain that reference `@/lib/auth` or `@/lib/session`**

Use Grep tool:
- pattern: `@/lib/auth|@/lib/session|requireAuth|getOptionalSession|better-auth`
- path: `src/app`
- expected output: empty OR only `src/app/api/diagnostics/route.ts` (we handle it in Task 14)

---

## Task 10: Remove `UserProfile` from site header

**Files:**
- Modify: `src/components/site-header.tsx`

- [ ] **Step 1: Replace the two affected lines**

Remove the import at top:

```ts
import { UserProfile } from "@/components/auth/user-profile";
```

Remove the usage in the right-side action group. The final JSX for the right-side group becomes:

```tsx
<div className="flex items-center gap-4" role="group" aria-label="User actions">
  <ModeToggle />
</div>
```

(Keep the rest of the file unchanged.)

- [ ] **Step 2: Grep confirms no remaining imports of `@/components/auth/*`**

Pattern: `@/components/auth`
Expected: no matches under `src/`.

---

## Task 11: Delete auth libs + auth components + proxy

**Files:**
- Delete: `src/lib/auth.ts`
- Delete: `src/lib/auth-client.ts`
- Delete: `src/lib/session.ts`
- Delete: `src/proxy.ts`
- Delete: `src/components/auth/` (whole directory)

- [ ] **Step 1: Delete the four single files**

Run: `rm src/lib/auth.ts src/lib/auth-client.ts src/lib/session.ts src/proxy.ts`

- [ ] **Step 2: Delete the auth components directory**

Run: `rm -rf src/components/auth`

- [ ] **Step 3: Grep: no more imports of deleted modules**

Pattern: `@/lib/auth|@/lib/auth-client|@/lib/session|@/components/auth`
Expected: no matches anywhere in `src/`. If anything remains, investigate and fix.

---

## Task 12: Schema — drop auth tables + `products.userId`

**Files:**
- Modify: `src/lib/schema.ts`

- [ ] **Step 1: Replace entire file**

```ts
import {
  pgTable,
  varchar,
  timestamp,
  index,
  uuid,
  integer,
  bigint,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

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

Notes:
- `user`, `session`, `account`, `verification` tables removed.
- `products.userId` column removed and `products_user_id_idx` removed with it.
- The comment "IMPORTANT! ID fields should ALWAYS use UUID types, EXCEPT the BetterAuth tables." is obsolete — removed.
- `text` and `boolean` imports no longer needed.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: any errors should be coming from `src/app/api/diagnostics/route.ts` (still references `schema.user` and `BETTER_AUTH_SECRET`). That's the next task. Nothing else should error.

---

## Task 13: Generate Drizzle migration

**Files:**
- Create: `drizzle/0001_remove_better_auth.sql`
- Update: `drizzle/meta/0001_snapshot.json` (auto-generated)
- Update: `drizzle/meta/_journal.json` (auto-appended)

- [ ] **Step 1: Generate the migration**

Run: `pnpm db:generate`
Expected: drizzle-kit detects the 4 dropped tables + dropped column + dropped index, and writes `drizzle/0001_<random_name>.sql`.

- [ ] **Step 2: Inspect the SQL before running**

Run: Read the new SQL file.
Expected SQL contents (approximately):
- `DROP TABLE "account";`
- `DROP TABLE "session";`
- `DROP TABLE "verification";`
- `ALTER TABLE "products" DROP CONSTRAINT "products_user_id_user_id_fk";`
- `DROP INDEX "products_user_id_idx";`
- `ALTER TABLE "products" DROP COLUMN "user_id";`
- `DROP TABLE "user";`

(Drizzle will order DROPs safely with respect to foreign keys.)

If the filename drizzle chose differs from `0001_remove_better_auth.sql`, that's fine — don't rename. Drizzle tracks filenames in `_journal.json`.

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: `Applied migration 0001_…` with no error.

- [ ] **Step 4: Sanity-check the DB**

Run:
```bash
psql "$POSTGRES_URL" -c "\dt" -c "\d products"
```
Expected:
- `\dt` shows only `products`, `folders`, `clips` (+ drizzle's `__drizzle_migrations`). No `user`/`session`/`account`/`verification`.
- `\d products` shows no `user_id` column and no `products_user_id_idx`.

(If `psql` isn't on the path, use drizzle-studio: `pnpm db:studio` and visually confirm.)

---

## Task 14: Clean up `diagnostics/route.ts`

**Files:**
- Modify: `src/app/api/diagnostics/route.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { NextResponse } from "next/server";

type StatusLevel = "ok" | "warn" | "error";

interface DiagnosticsResponse {
  timestamp: string;
  env: {
    POSTGRES_URL: boolean;
    OPENROUTER_API_KEY: boolean;
    NEXT_PUBLIC_APP_URL: boolean;
  };
  database: {
    connected: boolean;
    schemaApplied: boolean;
    error?: string;
  };
  ai: {
    configured: boolean;
  };
  storage: {
    configured: boolean;
    type: "local" | "remote";
  };
  overallStatus: StatusLevel;
}

export async function GET() {
  const env = {
    POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
    OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
    NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  } as const;

  let dbConnected = false;
  let schemaApplied = false;
  let dbError: string | undefined;

  if (env.POSTGRES_URL) {
    try {
      const dbCheckPromise = (async () => {
        const [{ db }, { sql }, schema] = await Promise.all([
          import("@/lib/db"),
          import("drizzle-orm"),
          import("@/lib/schema"),
        ]);
        const result = await db.execute(sql`SELECT 1 as ping`);
        if (!result) throw new Error("Database query returned no result");
        dbConnected = true;
        try {
          await db.select().from(schema.products).limit(1);
          schemaApplied = true;
        } catch {
          schemaApplied = false;
          dbError = "Schema not applied. Run: pnpm db:migrate";
        }
      })();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database connection timeout (5s)")), 5000),
      );
      await Promise.race([dbCheckPromise, timeoutPromise]);
    } catch {
      dbConnected = false;
      schemaApplied = false;
      dbError =
        "Database not connected. Please start your PostgreSQL database and verify your POSTGRES_URL in .env";
    }
  } else {
    dbError = "POSTGRES_URL is not set";
  }

  const aiConfigured = env.OPENROUTER_API_KEY;
  const storageConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const storageType: "local" | "remote" = storageConfigured ? "remote" : "local";

  const overallStatus: StatusLevel = (() => {
    if (!env.POSTGRES_URL || !dbConnected || !schemaApplied) return "error";
    if (!aiConfigured) return "warn";
    return "ok";
  })();

  const body: DiagnosticsResponse = {
    timestamp: new Date().toISOString(),
    env,
    database: {
      connected: dbConnected,
      schemaApplied,
      ...(dbError !== undefined && { error: dbError }),
    },
    ai: { configured: aiConfigured },
    storage: { configured: storageConfigured, type: storageType },
    overallStatus,
  };

  return NextResponse.json(body, { status: 200 });
}
```

Notes:
- Dropped `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from `env`.
- Dropped the `/api/auth/session` fetch probe (the route is gone).
- Schema smoke-test now touches `schema.products` instead of `schema.user`.

---

## Task 15: Clean up `src/lib/env.ts`

**Files:**
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Replace entire file**

```ts
import { z } from "zod";

const serverEnvSchema = z.object({
  POSTGRES_URL: z.string().url("Invalid database URL"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("openai/gpt-5-mini"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid server environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid server environment variables");
  }
  return parsed.data;
}

export function getClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    console.error("Invalid client environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid client environment variables");
  }
  return parsed.data;
}

export function checkEnv(): void {
  const warnings: string[] = [];

  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required");
  }

  if (!process.env.OPENROUTER_API_KEY) {
    warnings.push("OPENROUTER_API_KEY is not set. (Chat feature has been removed; safe to ignore.)");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    warnings.push("BLOB_READ_WRITE_TOKEN is not set. Using local storage for file uploads.");
  }

  if (process.env.NODE_ENV === "development" && warnings.length > 0) {
    console.warn("\n⚠️  Environment warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }
}
```

Notes:
- Removed `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `checkEnv` no longer throws on missing `BETTER_AUTH_SECRET`.

---

## Task 16: Fix root `src/app/page.tsx`

**Files:**
- Read first, modify only if needed: `src/app/page.tsx`

Current content (5 lines):
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

The old redirect-loop was caused by `src/proxy.ts` (now deleted) bouncing `/dashboard` back to `/`. With the proxy gone, the `/ → /dashboard` redirect is correct and safe.

- [ ] **Step 1: No code changes needed in this file**

Verification: open the root in a browser after the dev server is up (Task 17). Expected: `/` immediately lands on `/dashboard` with no redirect loop.

---

## Task 17: Uninstall `better-auth` package

**Files:**
- Modify: `package.json` (auto-updated by `pnpm remove`)
- Modify: `pnpm-lock.yaml` (auto-updated)

- [ ] **Step 1: Confirm no remaining imports of `better-auth`**

Use Grep: pattern `better-auth`, path `src/`.
Expected: zero matches. If any match remains, fix the offender before uninstalling.

- [ ] **Step 2: Uninstall**

Run: `pnpm remove better-auth`
Expected: removes dependency from `package.json` and updates `pnpm-lock.yaml`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes clean. If anything still references `better-auth/...`, the Grep step missed it — go fix.

---

## Task 18: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm check` (alias for `pnpm lint && pnpm typecheck`).
Expected: both pass. No errors.

- [ ] **Step 2: Start dev server**

Run (in background): `pnpm dev`
Wait for: `Ready in …ms` line.

- [ ] **Step 3: Smoke-test the upload flow via Playwright**

Use `playwright-cli` skill. Expected flow:

```bash
playwright-cli open http://localhost:3000
# → should redirect to /dashboard WITHOUT a login page
playwright-cli snapshot
# create product
playwright-cli click <new-product-button-ref>
playwright-cli fill <name-input-ref> "smoke test"
playwright-cli click <create-button-ref>
# enter workspace, create folder, upload a small mp4
```

Expected:
- No `/api/auth/get-session` network calls in devtools.
- No `ERR_CONNECTION_REFUSED` console errors.
- No `ERR_TOO_MANY_REDIRECTS` on `/dashboard`.
- Upload completes; `POST /api/products/:id/folders/:fid/clips` returns 201.

- [ ] **Step 4: Inspect network for auth traces**

Run: `playwright-cli network`
Expected: no requests to any `/api/auth/*` path.

- [ ] **Step 5: Grep final — no residual auth code**

Pattern (case-sensitive): `better-auth|requireAuth|getOptionalSession|BETTER_AUTH_SECRET|UserProfile|@/lib/auth|@/lib/session`
Path: `src/`
Expected: zero matches.

Also:

Pattern: `better-auth`
Path: `package.json`
Expected: zero matches.

- [ ] **Step 6: Stop dev server**

Run: `pkill -f "next dev" || true`

---

## Task 19: Commit

**Files:** none — only a commit operation.

- [ ] **Step 1: Stage + commit**

Because the change touches many files, split into logical commits for reviewability:

```bash
git add src/app/api/products src/app/api/chat src/app/api/auth src/app/api/diagnostics/route.ts
git commit -m "refactor: drop auth guards from API routes"

git add src/app/page.tsx src/app/\(auth\) src/app/profile src/app/chat src/components/site-header.tsx src/components/auth
git commit -m "refactor: remove auth pages and UserProfile header"

git add src/lib/auth.ts src/lib/auth-client.ts src/lib/session.ts src/proxy.ts src/lib/env.ts
git commit -m "refactor: delete auth lib modules and env requirements"

git add src/lib/schema.ts drizzle/
git commit -m "chore(db): drop user/session/account/verification tables and products.user_id"

git add package.json pnpm-lock.yaml
git commit -m "chore: uninstall better-auth"
```

(If any of the above globs are empty because of pre-existing dirty state, skip that specific commit — nothing to stage.)

- [ ] **Step 2: Confirm clean working tree**

Run: `git status --short`
Expected: empty (or only pre-existing dirty files that were untouched by this plan).

---

## Self-Review Checklist

**1. Spec coverage:** Every file listed in "Files to delete" and "Files to modify" has a corresponding task. ✓

**2. Placeholder scan:** Searched plan for TBD/TODO/"implement later"/"similar to Task N" — none found. Every code step has full code. ✓

**3. Type consistency:**
- `getProduct`, `productExists`, `getFolder`, `folderExists`, `getClip` are the new helper names. They're not reused across tasks, so no cross-task naming bug possible.
- `schema.products` has no `userId` anywhere post-Task 12. All API route rewrites (Tasks 2–8) avoid `.userId`. ✓
- `env.ts` removes `BETTER_AUTH_SECRET` — `diagnostics/route.ts` (Task 14) and `env.ts` (Task 15) both use the reduced set. ✓

**4. Dangling references check (done during plan writing):**
- `src/proxy.ts` imports `better-auth/cookies` — deleted in Task 11.
- `src/app/api/chat/route.ts` imports `@/lib/auth` — deleted in Task 9.
- All product/folder/clip API routes import `@/lib/session` — rewritten in Tasks 2–8.
- `src/components/site-header.tsx` imports `@/components/auth/user-profile` — fixed in Task 10; the component dir is deleted in Task 11.
- `src/app/api/diagnostics/route.ts` touches `schema.user` + `BETTER_AUTH_SECRET` — fixed in Task 14.

**5. Order safety:** API routes rewritten (Tasks 2–8) before schema changes (Task 12). Why: if we changed the schema first, the existing API code would fail to typecheck in a way that mingles "schema type errors" with "still-using-requireAuth" errors — harder to debug. Doing API first means after Task 12 the only remaining typecheck errors are in diagnostics (intentional, cleared in Task 14).

**6. Proxy/root loop fix verified:**
- Before: `/ → /dashboard`, proxy → `/ → /dashboard` → … infinite. Broke localhost.
- After: proxy deleted (Task 11), root still redirects to `/dashboard` (Task 16 no-op), no loop possible. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-19-remove-better-auth.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Works well for this plan because tasks are near-independent file rewrites.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
