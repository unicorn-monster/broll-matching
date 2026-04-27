# Auto-match Speed Cap & Chain-Pair

**Date:** 2026-04-27
**Status:** Design

## Problem

The current `matchSections` auto-matcher in [src/lib/auto-match.ts](../../../src/lib/auto-match.ts) has two undesirable behaviors:

1. **Case 1 (single clip ≥ section):** Picks any clip long enough and speeds it up to fit. Speed factor is unbounded — a 5s clip on a 1s section produces a jarring 5× speed-up.
2. **Case 2 (chain when no clip fits):** Loops `pickRandom` until total duration ≥ section. The chain length is non-deterministic, can be 3+ clips, and never slows down (early-exit guarantees overshoot).

The user wants natural-feeling pacing: small speed adjustments, otherwise trim, and predictable two-clip chains.

## Goals

Replace the body of `matchSections` (Case 1 and Case 2) with two new strategies:

1. **Case 1 — Speed cap with trim fallback:** Cap auto speed-up at 1.3×. If no candidate falls in `[1.0×, 1.3×]`, switch to trim mode (play 1× speed, cut the source to section length).
2. **Case 2 — Chain pair:** Always pick exactly two distinct candidates at random. Adjust speed (up *or* down, no cap, no floor) to fit section. If fewer than 2 variants exist, return a placeholder with a warning.

## Non-Goals

- No changes to `buildManualChain` / `validateChain`. Manual chains keep their existing rules (MIN_SPEED_FACTOR = 0.8, no upper cap).
- No changes to `render-worker.ts` — `trimDurationMs` handling already exists at [render-worker.ts:126](../../../src/workers/render-worker.ts#L126).
- No changes to `preview-player.tsx` — playback plan slot duration already constrains video playback to the slot window, so trim and slowdown work natively.
- No `-ss` (seek start) trim — always trim from the start of the source clip.
- `MAX_AUTO_SPEEDUP` is a constant. No user-configurable threshold.

## New Constants

In `src/lib/auto-match.ts`:

```ts
/** Auto-match Case 1 caps speed-up at this factor; above this we trim instead. */
export const MAX_AUTO_SPEEDUP = 1.3;

/** Auto-match Case 2 always picks exactly this many clips into a chain. */
export const CHAIN_PAIR_SIZE = 2;
```

## Algorithm

```
candidates = clipsByBaseName.get(section.tag.toLowerCase()) ?? []

if candidates.length === 0:
  → placeholder, warning "No B-roll found for tag: {tag}"

longEnough = candidates filter (c.durationMs >= section.durationMs)

if longEnough.length > 0:
  // Case 1
  speedupOk = longEnough filter (c.durationMs / section.durationMs <= MAX_AUTO_SPEEDUP)
  if speedupOk.length > 0:
    pick = random ∈ speedupOk
    → speedFactor = pick.durationMs / section.durationMs   // ∈ [1.0, 1.3]
    → trimDurationMs = undefined
  else:
    pick = random ∈ longEnough
    → speedFactor = 1
    → trimDurationMs = section.durationMs

else:
  // Case 2
  if candidates.length < 2:
    → placeholder, warning "Need ≥2 variants for chain mode (tag: {tag})"
  else:
    [clipA, clipB] = pickTwoDistinct(candidates)
    totalMs = clipA.durationMs + clipB.durationMs
    speedFactor = totalMs / section.durationMs   // any value, no cap
    → both clips share speedFactor; trimDurationMs = undefined
```

### Boundary semantics

- `c.durationMs / section.durationMs <= 1.3` is **inclusive** at exactly 1.3. A 1.3s clip on a 1s section is speed-up mode (1.30×), not trim.
- `clip.durationMs >= section.durationMs` is unchanged from current code (inclusive at equality → speedFactor 1.0, no work).
- `pickTwoDistinct(candidates)` returns two **different** clip metadata objects (by reference / by id). Order is randomised — speed factor is identical either way, but visual order on the timeline reflects pick order.

## Worked examples

| Section | Candidates | Path | Output |
|---|---|---|---|
| 1s | 1.2s, 5s, 3s | Case 1 — speedup ok | pick 1.2s, speedFactor 1.20× |
| 1s | 1.3s, 5s, 3s | Case 1 — speedup ok (boundary) | pick 1.3s, speedFactor 1.30× |
| 1s | 2s, 2.4s, 3s | Case 1 — trim | pick random, speedFactor 1×, trim 1s |
| 4s | 2s, 2.4s, 3s | Case 2 — speedup chain | e.g. 2+3=5s, speedFactor 1.25× |
| 5s | 2s, 2.4s | Case 2 — slowdown chain | pick 2+2.4=4.4s, speedFactor 0.88× |
| 4s | 2s only | Case 2 — invalid | placeholder, "Need ≥2 variants" |

## UI changes

### Timeline tile speed/trim badge

`ClipThumb` in [src/components/editor/timeline/track-clips.tsx](../../../src/components/editor/timeline/track-clips.tsx) currently renders only `speedFactor` when ≠ 1. Update so it also surfaces trim mode:

| Clip state | Badge |
|---|---|
| `trimDurationMs` is set | `1× ✂` (trim icon, distinct visual) |
| `trimDurationMs` is undefined and `speedFactor === 1` | (no badge) |
| `trimDurationMs` is undefined and `speedFactor !== 1` | `{speedFactor.toFixed(2)}×` (works for both >1 and <1) |

Tooltip on hover (use `title` attribute for simplicity):
- Trim: `"Trimmed to {sectionMs/1000}s (1× speed)"`
- Speed: `"{speedFactor.toFixed(2)}× speed"` — same wording for speedup and slowdown.

`ClipThumb` props change: add `trimDurationMs?: number` and `sectionMs: number`. The parent `TrackClips` already has access to both via the section + clip data.

### Timeline section-level warning

[track-tags.tsx:24](../../../src/components/editor/timeline/track-tags.tsx#L24) currently flags sections where any clip's `speedFactor > HIGH_SPEED_THRESHOLD` (= 2.0). With Case 1 now capped at 1.3 and trim-mode clips having `speedFactor = 1`, this warning will only trigger from Case 2 chains that overshoot 2× — which is the intended remaining use of the warning. **No change** to track-tags.tsx.

`HIGH_SPEED_THRESHOLD` keeps its current value (2.0) and current callers.

## Tests

All in `src/lib/__tests__/auto-match.test.ts`. Existing tests for the prior chain behavior need to be **updated**, not just augmented — the chain semantics change.

### Case 1 — speedup with cap

1. All `longEnough` candidates have speedFactor ≤ 1.3 → speedup mode, picks from this subset only.
2. All `longEnough` candidates have speedFactor > 1.3 → trim mode, `speedFactor === 1`, `trimDurationMs === sectionMs`.
3. Mixed: some ≤ 1.3, some > 1.3 → only picks from the ≤ 1.3 subset (verify ID is in the eligible subset across multiple invocations or use a seeded random).
4. Boundary: clip duration exactly `1.3 × sectionMs` → speedup mode, factor exactly 1.30.

### Case 2 — chain pair

5. ≥ 2 variants, both shorter than section, sum > section → speedup chain (factor > 1).
6. ≥ 2 variants, both shorter than section, sum < section → slowdown chain (factor < 1).
7. ≥ 2 variants, both shorter than section, sum exactly = section → factor exactly 1.
8. Exactly 2 distinct variants → both get picked (no choice).
9. ≥ 3 variants → exactly 2 chosen, and they are distinct (different `clipId`s).
10. Only 1 variant in candidates → placeholder, warning includes `"Need ≥2 variants"` and the tag.

### Backward compatibility

11. Empty candidates → placeholder with `"No B-roll found for tag: {tag}"` (unchanged).
12. `section.durationMs === 0` → empty `clips` array (unchanged).

### Side effects

- The `MatchedClip` type already has `trimDurationMs?: number`. No type changes.
- Any existing test that asserts the old multi-clip chain behavior (e.g., chain of 3) needs to be rewritten for two-clip semantics. Audit every existing test in `auto-match.test.ts` against the new algorithm.

## Risks / open questions

- **Slowdown without floor** (Case 2, e.g., 0.3×) produces noticeably slow video. User explicitly chose unlimited slowdown; we honor it.
- **Random-picking determinism in tests** — if `pickRandom` is hard to stub, prefer assertions over the *set* of acceptable outputs (e.g., "result is one of `[clipA.id, clipB.id]`") rather than seeded randomness. The existing test file uses this style.
- **Section-level warnings** with `HIGH_SPEED_THRESHOLD = 2.0` will still fire for Case 2 fast chains — intentional. Slowdown produces no warning currently, and we don't add one (out of scope).

## Files touched

| Action | Path | Why |
|---|---|---|
| Modify | `src/lib/auto-match.ts` | New constants + rewrite Case 1 & Case 2 in `matchSections` |
| Modify | `src/lib/__tests__/auto-match.test.ts` | Update existing chain tests + add new cases |
| Modify | `src/components/editor/timeline/track-clips.tsx` | `ClipThumb` shows trim badge / slowdown factor |

`render-worker.ts`, `preview-player.tsx`, `playback-plan.ts`, `track-tags.tsx`, `inspector-panel.tsx`, `buildManualChain`/`validateChain` are all **unchanged**.
