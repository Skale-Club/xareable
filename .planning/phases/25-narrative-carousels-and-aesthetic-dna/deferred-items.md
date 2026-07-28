# Deferred Items — Phase 25

Out-of-scope issues observed during execution, logged (not fixed) per the
executor's scope-boundary rule.

## From 25-05 (Aesthetic DNA dense content + backfill)

- **`npm run check` transient failures in `server/services/carousel-plan-schema.service.ts`**
  (3 errors: missing `./planning-schema.js` module, ES2015 regex flag, Set
  iteration without `--downlevelIteration`). This file is untracked, owned by
  a parallel in-flight executor (plan 25-03) in the same wave, and outside
  25-05's `files_modified` (`shared/schema.ts`,
  `server/routes/style-catalog.routes.ts`). Confirmed both of 25-05's own
  files compile with zero errors under `npm run check`. Not fixed here —
  expected to resolve once 25-03 finishes and commits its own work.

## From 25-07 (Typography compositor treatment param)

- **Same `npm run check` transient failure, reconfirmed.** At 25-07's
  completion time, `server/services/carousel-plan-schema.service.ts` (still
  untracked, plan 25-03's in-flight file) was the ONLY source of `npm run
  check` errors — 2 errors this time (`TS1501` regex flag, `TS2802` Set
  iteration). Grepped the full `npm run check` output for
  `typography-compositor` / `test-typography-treatment`: zero matches, i.e.
  both of 25-07's own files (`server/services/typography-compositor.service.ts`,
  `scripts/test-typography-treatment.ts`) compile cleanly. Not fixed here —
  out of 25-07's `files_modified` scope; expected to resolve once 25-03
  commits.
- **Pre-existing `drawBlocks` font-state bug (not fixed, by design).**
  `drawBlocks()` never sets `ctx.font` itself — it relies on whatever font
  `ctx` was left in by the LAST block iterated inside `layoutBlocks()`'s
  measurement loop, so all blocks in a multi-block layout render with that
  one block's alias/size rather than each block's own. This predates Phase 25
  (present in the original Phase 23 `typography-compositor.service.ts`) and
  is untouched here: fixing it would change Phase 23's own no-treatment
  output, violating 25-07's explicit "byte-identical to Phase 23" constraint
  (confirmed byte-identical via `scripts/test-typography-treatment.ts`'s
  identity-vs-omitted-treatment assertions and `scripts/verify-golden-image.ts`
  staying green). `resolveTypographyTreatment`'s `roleAliasOverride` and
  `sizeScale` still have real, testable effects on `layoutBlocks`' word-wrap
  and `meta.fonts` output; only the FINAL fillText's typeface/size for
  non-last blocks is affected by the pre-existing bug. Flagging for a future
  Phase 26/hygiene pass, not this plan's scope.
