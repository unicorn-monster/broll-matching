# Auto-match Speed Cap & Chain-Pair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `matchSections` Case 1 (single clip speedup, unbounded) and Case 2 (open-ended chain) with capped speedup + trim fallback (Case 1) and exactly-two-clip random pair (Case 2).

**Architecture:** Three changes in two files. (1) `auto-match.ts` — add `MAX_AUTO_SPEEDUP` / `CHAIN_PAIR_SIZE` constants and a `pickTwoDistinct` helper, then rewrite the body of `matchSections` for both cases. (2) `auto-match.test.ts` — update tests that asserted the old behavior (some Scenario A / B cases break) and add new coverage for the cap, trim, slowdown, and `<2 variants` placeholder paths. (3) `track-clips.tsx` — `ClipThumb` shows a `1× ✂` trim badge when `trimDurationMs` is set, otherwise the existing speed badge.

**Tech Stack:** TypeScript, Vitest 4 (node env), React 19 + Tailwind CSS for the UI.

**Spec:** [docs/superpowers/specs/2026-04-27-auto-match-speed-cap-and-chain-pair-design.md](../specs/2026-04-27-auto-match-speed-cap-and-chain-pair-design.md)

---

## File Structure

| Action | Path | Responsibility |
| ------ | ---- | -------------- |
| Modify | `src/lib/auto-match.ts` | Add `MAX_AUTO_SPEEDUP`, `CHAIN_PAIR_SIZE`, `pickTwoDistinct`. Rewrite Case 1 (speed cap + trim fallback) and Case 2 (chain pair) inside `matchSections`. |
| Modify | `src/lib/__tests__/auto-match.test.ts` | Replace the old "Scenario A / B" tests with the new behavior; keep all unrelated tests (`buildClipsByBaseName`, `computeChainSpeed`, `validateChain`, `buildManualChain`, "no matching base name", "zero-duration section") untouched. |
| Modify | `src/components/editor/timeline/track-clips.tsx` | `ClipThumb` accepts and renders trim mode. Caller passes `c.trimDurationMs` from the matched clip. |

`render-worker.ts`, `preview-player.tsx`, `playback-plan.ts`, `track-tags.tsx`, `inspector-panel.tsx`, `buildManualChain`, and `validateChain` are intentionally **not** modified — see spec "Non-Goals".

---

## Task 1: Auto-match Case 1 — speed cap with trim fallback

**Files:**
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/auto-match.ts`

**Why these changes ride together:** Some existing tests assert old behavior that the new implementation invalidates (e.g. a 5× speedup with no trim). Updating tests and implementation in the same commit keeps the suite green at every commit boundary.

- [ ] **Step 1: Replace Case 1 tests (RED)**

In `src/lib/__tests__/auto-match.test.ts`, locate the `describe("matchSections", ...)` block. Inside it, **delete** the following three existing tests (they assert behavior the new logic invalidates):

1. `it("Scenario A: section shorter than clip — speeds up", ...)` — currently lines 50–57.
2. `it("Scenario A: speed > 2x — speeds up freely without trim", ...)` — currently lines 59–65.
3. `it("never slows down: all picked clips play at speedFactor >= 1.0", ...)` — currently lines 88–102. (Its purpose is obsolete: with chain pair always picking 2 distinct, the original "slow-down via shorter candidate" bug it guarded against can no longer occur.)
4. `it("single-clip case with only-shorter candidates still avoids slow-down", ...)` — currently lines 120–127. (With chain pair requiring `≥2 variants`, a single short variant now produces a placeholder, not a chain.)

Then **insert** the following new tests inside the same `describe("matchSections", ...)` block (placement: just after the existing `it("zero-duration section — empty clips", ...)` test):

```ts
  it("Case 1 speedup-ok: clip <= 1.3x section — picks from speedup-ok subset", () => {
    // Section 1s, candidates: 1.2s (ratio 1.2 ✓), 5s (ratio 5 ✗), 3s (ratio 3 ✗)
    const clips = [makeClip("hook-01", 1200), makeClip("hook-02", 5000), makeClip("hook-03", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 50; trial++) {
      const [matched] = matchSections([makeSection("Hook", 1000)], map);
      expect(matched.clips).toHaveLength(1);
      const c = matched.clips[0]!;
      // Only the 1.2s clip is speedup-ok
      expect(c.clipId).toBe("hook-01");
      expect(c.speedFactor).toBeCloseTo(1.2, 4);
      expect(c.trimDurationMs).toBeUndefined();
      expect(c.isPlaceholder).toBe(false);
    }
  });

  it("Case 1 boundary: clip exactly 1.3x section — speedup mode (inclusive)", () => {
    // Section 1s, clip 1.3s. Ratio = 1.3 exactly, qualifies as speedup-ok.
    const clips = [makeClip("hook-01", 1300)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 1000)], map);
    expect(matched.clips).toHaveLength(1);
    const c = matched.clips[0]!;
    expect(c.speedFactor).toBeCloseTo(1.3, 4);
    expect(c.trimDurationMs).toBeUndefined();
  });

  it("Case 1 trim fallback: all longEnough > 1.3x section — trim mode", () => {
    // Section 1s, candidates all > 1.3s: 2s, 2.4s, 3s.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 2400), makeClip("hook-03", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 50; trial++) {
      const [matched] = matchSections([makeSection("Hook", 1000)], map);
      expect(matched.clips).toHaveLength(1);
      const c = matched.clips[0]!;
      expect(c.speedFactor).toBe(1);
      expect(c.trimDurationMs).toBe(1000);
      expect(c.isPlaceholder).toBe(false);
      // The picked clip is one of the longEnough candidates.
      expect(["hook-01", "hook-02", "hook-03"]).toContain(c.clipId);
    }
  });

  it("Case 1 mixed: only picks from speedup-ok subset, never from trim-only candidates", () => {
    // Section 1s. 1.2s is speedup-ok; 5s would be trim-only. Pick must always be 1.2s.
    const clips = [makeClip("hook-01", 1200), makeClip("hook-02", 5000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 100; trial++) {
      const [matched] = matchSections([makeSection("Hook", 1000)], map);
      expect(matched.clips[0]!.clipId).toBe("hook-01");
      expect(matched.clips[0]!.trimDurationMs).toBeUndefined();
    }
  });
```

- [ ] **Step 2: Run tests to verify the new tests fail and the deletions don't break unrelated tests**

Run: `pnpm test src/lib/__tests__/auto-match.test.ts`

Expected: FAIL — the four new tests fail because `matchSections` still uses the old uncapped Case 1 logic (no `MAX_AUTO_SPEEDUP` filter, never sets `trimDurationMs`). Other tests in the file should pass (they don't touch the changed paths).

- [ ] **Step 3: Add the constant and rewrite Case 1 (GREEN)**

In `src/lib/auto-match.ts`, after the existing `MIN_SPEED_FACTOR` line (currently line 8), add:

```ts
/** Auto-match Case 1 caps speed-up at this factor; above this we trim instead. */
export const MAX_AUTO_SPEEDUP = 1.3;
```

Then locate the existing Case 1 block in `matchSections` (currently lines 149–160):

```ts
    // Case 1: at least one clip is long enough — single clip, speed up or keep 1x (never slow).
    const longEnough = candidates.filter((c) => c.durationMs >= section.durationMs);
    if (longEnough.length > 0) {
      const clip = pickRandom(longEnough);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [singleClipMatch(clip, section.durationMs)],
        warnings,
      };
    }
```

Replace it with:

```ts
    // Case 1: at least one clip is long enough — speedup if natural ratio <= MAX_AUTO_SPEEDUP,
    // otherwise trim a longer clip down to section length and play at 1x.
    const longEnough = candidates.filter((c) => c.durationMs >= section.durationMs);
    if (longEnough.length > 0) {
      const speedupOk = longEnough.filter(
        (c) => c.durationMs / section.durationMs <= MAX_AUTO_SPEEDUP,
      );
      if (speedupOk.length > 0) {
        const clip = pickRandom(speedupOk);
        return {
          sectionIndex,
          tag: section.tag,
          durationMs: section.durationMs,
          clips: [singleClipMatch(clip, section.durationMs)],
          warnings,
        };
      }
      // Trim fallback: speedFactor stays 1, source is cut to section length.
      const clip = pickRandom(longEnough);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{
          clipId: clip.id,
          indexeddbKey: clip.indexeddbKey,
          speedFactor: 1,
          trimDurationMs: section.durationMs,
          isPlaceholder: false,
        }],
        warnings,
      };
    }
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test src/lib/__tests__/auto-match.test.ts`

Expected: PASS — all tests in `auto-match.test.ts` pass, including the four new ones.

- [ ] **Step 5: Run the full test suite to verify no regressions elsewhere**

Run: `pnpm test`

Expected: PASS — full suite green. (Pre-existing typecheck/lint errors on this branch are unrelated and not run by `pnpm test`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): cap Case 1 speedup at 1.3x with trim fallback

When the chosen clip's natural play ratio exceeds 1.3x, switch to
trim mode: speedFactor stays at 1 and trimDurationMs is set to the
section length. Render-worker already honors trimDurationMs."
```

---

## Task 2: Auto-match Case 2 — chain pair

**Files:**
- Modify: `src/lib/__tests__/auto-match.test.ts`
- Modify: `src/lib/auto-match.ts`

- [ ] **Step 1: Replace Case 2 tests (RED)**

In `src/lib/__tests__/auto-match.test.ts`, locate and **delete** the following two tests inside `describe("matchSections", ...)`:

1. `it("Scenario B: section longer than clip — chains", ...)` — currently lines 67–72.
2. `it("chains multiple clips uniformly sped up when no single clip fits", ...)` — currently lines 104–118.

Then **insert** the following new tests inside the same `describe("matchSections", ...)` block (placement: just after the four Case 1 tests added in Task 1):

```ts
  it("Case 2 speedup pair: total > section — both clips share speedFactor > 1", () => {
    // Section 4s, candidates 2s + 3s → total 5s, ratio 1.25.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    for (let trial = 0; trial < 30; trial++) {
      const [matched] = matchSections([makeSection("Hook", 4000)], map);
      expect(matched.clips).toHaveLength(2);
      const [a, b] = matched.clips;
      expect(a!.speedFactor).toBeCloseTo(1.25, 4);
      expect(b!.speedFactor).toBeCloseTo(1.25, 4);
      expect(a!.trimDurationMs).toBeUndefined();
      expect(b!.trimDurationMs).toBeUndefined();
      // distinct clip IDs
      expect(a!.clipId).not.toBe(b!.clipId);
    }
  });

  it("Case 2 slowdown pair: total < section — speedFactor < 1, no floor", () => {
    // Section 5s, candidates 2s + 2.4s → total 4.4s, ratio 0.88.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 2400)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 5000)], map);
    expect(matched.clips).toHaveLength(2);
    expect(matched.clips[0]!.speedFactor).toBeCloseTo(0.88, 4);
    expect(matched.clips[1]!.speedFactor).toBeCloseTo(0.88, 4);
  });

  it("Case 2 exact fit: total == section — speedFactor === 1", () => {
    // Section 5s, candidates 2s + 3s → total 5s, ratio 1.0 exactly.
    const clips = [makeClip("hook-01", 2000), makeClip("hook-02", 3000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 5000)], map);
    expect(matched.clips).toHaveLength(2);
    expect(matched.clips[0]!.speedFactor).toBe(1);
    expect(matched.clips[1]!.speedFactor).toBe(1);
  });

  it("Case 2 distinct picks: 3+ variants — pair is always two different clips", () => {
    const clips = [
      makeClip("hook-01", 1500),
      makeClip("hook-02", 1700),
      makeClip("hook-03", 1900),
    ];
    const map = buildClipsByBaseName(clips);
    const seenPairs = new Set<string>();
    for (let trial = 0; trial < 200; trial++) {
      const [matched] = matchSections([makeSection("Hook", 5000)], map);
      expect(matched.clips).toHaveLength(2);
      const [a, b] = matched.clips;
      expect(a!.clipId).not.toBe(b!.clipId);
      seenPairs.add([a!.clipId, b!.clipId].sort().join("+"));
    }
    // Sanity: with 3 variants there are 3 unordered pairs; a healthy random
    // sampler should produce more than one in 200 trials. This guards against
    // an implementation that always returns the same two clips.
    expect(seenPairs.size).toBeGreaterThan(1);
  });

  it("Case 2 placeholder when fewer than 2 variants exist", () => {
    // Single short variant: longEnough is empty, candidates.length === 1 → placeholder.
    const clips = [makeClip("hook-01", 2000)];
    const map = buildClipsByBaseName(clips);
    const [matched] = matchSections([makeSection("Hook", 5000)], map);
    expect(matched.clips).toHaveLength(1);
    expect(matched.clips[0]!.isPlaceholder).toBe(true);
    expect(matched.clips[0]!.clipId).toBe("placeholder");
    expect(matched.warnings.some((w) => w.includes("Need ≥2 variants"))).toBe(true);
    expect(matched.warnings.some((w) => w.toLowerCase().includes("hook"))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/__tests__/auto-match.test.ts`

Expected: FAIL — the new Case 2 tests fail because the existing chain logic loops `pickRandom` until `total >= section`, never produces slowdown, and never produces a placeholder when only one variant exists.

- [ ] **Step 3: Add the helper, the constant, and rewrite Case 2 (GREEN)**

In `src/lib/auto-match.ts`:

(a) After the existing `MAX_AUTO_SPEEDUP` line (added in Task 1), add:

```ts
/** Auto-match Case 2 always picks exactly this many clips into a chain. */
export const CHAIN_PAIR_SIZE = 2;
```

(b) After the existing `pickRandom` helper (currently lines 112–116), add a new helper:

```ts
/** Pick two distinct elements from an array. Caller must guarantee arr.length >= 2. */
function pickTwoDistinct<T>(arr: T[]): [T, T] {
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * (arr.length - 1));
  if (j >= i) j += 1;
  return [arr[i]!, arr[j]!];
}
```

(c) Locate the existing Case 2 block in `matchSections` (currently lines 162–188):

```ts
    // Case 2: no single clip fits — chain clips until total >= section, speed up all uniformly.
    // Every candidate here has duration < section.durationMs, so the overshoot < section.durationMs,
    // making the resulting speedFactor strictly < 2.0 (no cap/trim needed).
    const chain: ClipMetadata[] = [];
    let totalMs = 0;
    let lastClip: ClipMetadata | undefined;
    while (totalMs < section.durationMs) {
      const clip = pickRandom(candidates, lastClip);
      chain.push(clip);
      lastClip = clip;
      totalMs += clip.durationMs;
    }

    const speedFactor = totalMs / section.durationMs;
    return {
      sectionIndex,
      tag: section.tag,
      durationMs: section.durationMs,
      clips: chain.map((c) => ({
        clipId: c.id,
        indexeddbKey: c.indexeddbKey,
        speedFactor,
        isPlaceholder: false,
      })),
      warnings,
    };
```

Replace it with:

```ts
    // Case 2: no single clip fits the section — pick exactly CHAIN_PAIR_SIZE distinct
    // candidates and adjust the shared speedFactor to fit. No cap, no floor.
    if (candidates.length < CHAIN_PAIR_SIZE) {
      warnings.push(`Need ≥${CHAIN_PAIR_SIZE} variants for chain mode (tag: ${section.tag})`);
      return {
        sectionIndex,
        tag: section.tag,
        durationMs: section.durationMs,
        clips: [{ clipId: "placeholder", indexeddbKey: "", speedFactor: 1, isPlaceholder: true }],
        warnings,
      };
    }

    const [clipA, clipB] = pickTwoDistinct(candidates);
    const totalMs = clipA.durationMs + clipB.durationMs;
    const speedFactor = totalMs / section.durationMs;
    return {
      sectionIndex,
      tag: section.tag,
      durationMs: section.durationMs,
      clips: [
        { clipId: clipA.id, indexeddbKey: clipA.indexeddbKey, speedFactor, isPlaceholder: false },
        { clipId: clipB.id, indexeddbKey: clipB.indexeddbKey, speedFactor, isPlaceholder: false },
      ],
      warnings,
    };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test src/lib/__tests__/auto-match.test.ts`

Expected: PASS — all `matchSections` tests now pass, including the five new Case 2 tests from Step 1.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`

Expected: PASS — full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auto-match.ts src/lib/__tests__/auto-match.test.ts
git commit -m "feat(auto-match): replace open-ended chain with random distinct pair

Case 2 now picks exactly two distinct candidates and uses their
combined duration to derive a shared speedFactor. Speedup and
slowdown are both unbounded; if fewer than two variants exist
the section becomes a placeholder with a warning."
```

---

## Task 3: UI — trim badge in track-clips

**Files:**
- Modify: `src/components/editor/timeline/track-clips.tsx`

- [ ] **Step 1: Update `ClipThumb` to accept and render trim mode**

In `src/components/editor/timeline/track-clips.tsx`, locate the existing `ClipThumb` function (currently lines 50–75) and replace it in full with:

```tsx
function ClipThumb({
  thumbKey,
  speedFactor,
  trimDurationMs,
  sectionMs,
}: {
  thumbKey: string;
  speedFactor: number;
  trimDurationMs?: number;
  sectionMs: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let active = true;
    getThumbnail(thumbKey).then((buf) => {
      if (!active || !buf) return;
      url = URL.createObjectURL(new Blob([buf], { type: "image/jpeg" }));
      setSrc(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [thumbKey]);

  const isTrim = trimDurationMs != null;
  const tooltip = isTrim
    ? `Trimmed to ${(sectionMs / 1000).toFixed(2)}s (1× speed)`
    : `${speedFactor.toFixed(2)}× speed`;

  return (
    <div className="relative flex-1 min-w-0 bg-black/40" title={tooltip}>
      {src && <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {isTrim ? (
        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1">
          1× ✂
        </span>
      ) : speedFactor !== 1 ? (
        <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1">
          {speedFactor.toFixed(2)}×
        </span>
      ) : null}
    </div>
  );
}
```

(Changes from the current implementation: two new props `trimDurationMs` and `sectionMs`; a `title` tooltip on the wrapper; trim badge takes precedence over the speed badge; speed badge format changed from `toFixed(1)` to `toFixed(2)` to match the spec — slowdown values like 0.88 need two decimals.)

- [ ] **Step 2: Update the call site to pass the new props**

In the same file, locate the existing JSX that renders `ClipThumb` (currently line 40):

```tsx
                <ClipThumb key={j} thumbKey={c.indexeddbKey} speedFactor={c.speedFactor} />
```

Replace it with:

```tsx
                <ClipThumb
                  key={j}
                  thumbKey={c.indexeddbKey}
                  speedFactor={c.speedFactor}
                  trimDurationMs={c.trimDurationMs}
                  sectionMs={section.durationMs}
                />
```

(`section` is already in scope as the outer map's parameter; `c.trimDurationMs` is already on the matched clip type.)

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: zero **new** errors in `track-clips.tsx` or `auto-match.ts`. Pre-existing typecheck errors on this branch (in `auto-match.test.ts`, `script-parser.test.ts`, `render-worker.ts`, `clip-upload.tsx`, `auto-match.ts`'s pre-existing diagnostics) are out of scope — verify by running `git stash` then `pnpm typecheck` to confirm the same errors exist without these changes, then `git stash pop` to restore.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`

Expected: PASS — no new failures.

- [ ] **Step 5: Manually verify in the dev server**

Run: `pnpm dev`. Open the editor for a product with a script that triggers each path:

1. **Speedup mode** — pick a section/tag where at least one variant has duration in `[1.0×, 1.3×]` of the section. Expected: tile shows `{factor}×` badge with two decimals (e.g. `1.20×`); tooltip on hover reads `"{factor}× speed"`.
2. **Trim mode** — pick a section/tag where every variant has duration > `1.3 ×` section. Expected: tile shows `1× ✂` badge; tooltip reads `"Trimmed to {seconds}s (1× speed)"`.
3. **Chain pair speedup** — section longer than the longest variant, with at least 2 variants whose sum > section. Expected: two side-by-side thumbs, both with the same `{factor}×` badge ≥ 1.
4. **Chain pair slowdown** — section longer than the sum of two shortest variants. Expected: two thumbs, both with the same `{factor}×` badge < 1 (e.g. `0.88×`). No warning icon (slowdown is intentional and unbounded per spec).
5. **Placeholder when only 1 variant + no fit** — section longer than the only variant. Expected: red `▣` placeholder block; section block has the dashed red border (existing styling); warning visible in inspector.

If any check fails (e.g. trim mode tile shows `1.00×` instead of `1× ✂`), inspect the matched clip data in React DevTools to confirm `trimDurationMs` is populated, and confirm `sectionMs` is plumbed through. Fix and re-verify before committing.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/timeline/track-clips.tsx
git commit -m "feat(timeline): show trim badge and 2-decimal speed badge on ClipThumb

Surface trim-mode clips with a 1× ✂ marker so users can distinguish
them from natural-1× single-variant matches. Bumps speed badge to
two decimals so slowdown chains (e.g. 0.88×) are readable."
```

---

## Self-review notes

**Spec coverage:**
- Constants `MAX_AUTO_SPEEDUP` + `CHAIN_PAIR_SIZE` → Tasks 1 & 2.
- Case 1 algorithm (speedup ok / trim fallback) → Task 1.
- Case 2 algorithm (≥2 variants → pickTwoDistinct, share speedFactor; <2 → placeholder + warning) → Task 2.
- Boundary semantics (1.3 inclusive, distinct picks) → Task 1 boundary test, Task 2 distinct-picks test.
- Worked examples (1s/1.2s, 1s/2s, 4s/2+3, 5s/2+2.4, 4s/2-only) → covered by Task 1 & 2 tests.
- UI badge logic (trim → `1× ✂`; speedFactor=1 + no trim → no badge; otherwise factor) → Task 3.
- Tooltip wording → Task 3.
- "No changes to render-worker / preview-player / playback-plan / track-tags / inspector / manual chain" → upheld by file-list scope.

**Placeholder scan:** No "TBD" / "TODO" / vague phrasing. Every code block is complete and copy-paste ready.

**Type consistency:**
- `MatchedClip` already has `trimDurationMs?: number` (auto-match.ts line 66) — no type changes needed.
- `pickTwoDistinct<T>(arr: T[]): [T, T]` is referenced in Task 2 step 1 tests (implicitly via `matched.clips` shape) and defined in Task 2 step 3.
- `MAX_AUTO_SPEEDUP` is added in Task 1 and used in the same task's implementation.
- `CHAIN_PAIR_SIZE` is added in Task 2 and used in the same task's implementation.
- `ClipThumb` props `(thumbKey, speedFactor, trimDurationMs, sectionMs)` match between definition (Task 3 Step 1) and call site (Task 3 Step 2).
