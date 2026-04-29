# Action Required: B-Roll Auto Assembly Tool

Manual steps that must be completed by a human. These cannot be automated.

## Before Implementation

- [x] **Create a Supabase project** — The app uses Supabase as a hosted PostgreSQL database. Create a project at https://supabase.com and obtain the connection string.
- [x] **Set `DATABASE_URL` environment variable** — Add the Supabase PostgreSQL connection string to `.env.local` so Drizzle ORM can connect. Format: `postgresql://postgres:<password>@<host>:5432/postgres`
- [x] **Verify better-auth is configured** — The starter kit includes better-auth. Ensure `BETTER_AUTH_SECRET` and any other auth env vars are set in `.env.local`.

## Schema Migration (run before writing new code)

- [ ] **Reset the database** — Old `tags` and `clips` tables exist with test data. Run `pnpm db:reset` (`drizzle-kit drop && drizzle-kit push`) to drop the old schema and push the new one. This deletes all existing data (2 test clips — acceptable).
- [ ] **Clear IndexedDB** — After `pnpm db:reset`, open Chrome DevTools → Application → IndexedDB → `broll-auto-assembly` → Delete database. This removes orphaned clip binaries that no longer have Postgres metadata.

## During Implementation

- [ ] **Test in Chrome 110+ or Edge 110+** — FFmpeg.wasm requires SharedArrayBuffer which is only supported in these browsers. Safari and Firefox will not work.

## After Implementation

- [ ] **Prepare B-roll clip library** — Name files following the convention `{base-name}-{NN}.mp4` (all lowercase, e.g., `fs-clipper-freakout-01.mp4`, `hook-01.mp4`) before uploading. Files not matching this pattern will be rejected in the upload staging table.

---

> **Note:** These tasks are also listed in context within `implementation-plan.md`

