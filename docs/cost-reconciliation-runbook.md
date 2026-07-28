# Cost reconciliation runbook

**Created:** 2026-07-28
**Requirement:** POL-08 (v1.6)
**Status:** scheduled, not yet run

> **This audit does not gate the v1.6 milestone close.** It requires one full billing period of real OpenRouter gateway traffic that has not accumulated yet. The milestone ships with this audit scheduled and documented; the reconciliation itself completes later, after the billing period elapses.

## Why this exists

The OpenRouter gateway migration (Phase 21) replaced a static token-pricing estimate with OpenRouter's real per-request `usage.cost`, recorded on every generation/edit/transcribe call as `usage_events.cost_usd_micros` (Phase 21 GATE-05). Until one full billing period of real traffic has accumulated on this new pricing path, there is nothing to reconcile — a single day or partial week of samples cannot distinguish a systematic mis-attribution from ordinary day-to-day variance.

The risk this audit controls: a systematic mismatch between what OpenRouter actually bills the platform and what `usage_events` recorded as the real cost. Left unchecked, this would silently distort margin — every downstream number (markup ratio, affiliate commission, platform net) is computed from `cost_usd_micros`, so a drifted or mis-recorded cost quietly poisons all of them.

## Source of truth

| Source | Role |
|---|---|
| `usage_events.cost_usd_micros` | **PRIMARY source of truth** — the real per-request cost recorded at charge time (`recordUsageEvent` in `server/quota.ts`) |
| `usage_events.charged_amount_micros` | What the user was billed (cost + markup) — used to sanity-check the markup ratio, not the platform cost |
| `generation_logs` (`event_kind='visual_critic'` / `'model_fallback'`) | **Investigation only** — never a second primary total. Use `metadata.reroll_cost_usd_micros` (visual_critic rows, Phase 24) and fallback rows (`metadata.call_class` / `from_model` / `to_model`, Phase 21) to EXPLAIN a delta after one is found |
| OpenRouter dashboard export | The external comparison side. No API integration exists in this codebase (out of scope for POL-08) — the operator exports it by hand from the OpenRouter Activity/Usage screen |

This audit treats `usage_events` as authoritative and `generation_logs` as diagnostic. Do not add a second "total cost" derived from `generation_logs` — it was never designed to sum to the same number as `usage_events` (it logs individual quality-pipeline events, not every billed request).

## When to run

**Trigger rule:** one full billing period (30 days) after the first production deploy in which every AI call class (text/planning, image, transcription, critic) routes through OpenRouter and records a real cost. Find that date with:

```sql
select min(created_at) from usage_events where metadata->>'real_cost_usd_micros' is not null;
```

Run the first audit 30 days after that date. After the first audit, repeat this procedure **quarterly**.

**Owner:** the platform operator / repo owner (whoever holds the OpenRouter dashboard login and the production `SUPABASE_SERVICE_ROLE_KEY`).

## Procedure

1. Run the reconciliation scaffold against production credentials for the target date range:
   ```bash
   npx tsx scripts/reconcile-openrouter-costs.ts --from=2026-08-01 --to=2026-08-31
   ```
   Capture the **grand total real cost** printed in its final table.

2. Export the same date range from the OpenRouter dashboard (Activity / Usage tab). Capture its **total spend** for that range.

3. Compute the discrepancy:
   ```
   discrepancy = |openrouter_total - usage_events_total| / openrouter_total
   ```

4. Apply the threshold (below). Under threshold: record the outcome and stop. At/over threshold: continue to step 5.

5. Investigate using the three `generation_logs` queries named in "Known sources of benign delta" below — run all three verbatim, in order:

   **a. Visual-critic re-roll cost sum** (platform-side spend that is NOT charged to the user, so it inflates the OpenRouter total relative to `usage_events.charged_amount_micros` but should already be present in `usage_events.cost_usd_micros`'s metadata):
   ```sql
   select date_trunc('day', created_at) as day,
          sum((metadata->>'reroll_cost_usd_micros')::bigint) as reroll_cost_micros,
          sum((metadata->>'reroll_attempt_count')::int) as reroll_attempts
   from generation_logs
   where event_kind = 'visual_critic'
     and created_at >= '2026-08-01' and created_at < '2026-09-01'
   group by 1 order by 1;
   ```

   **b. Model-fallback count by call class** (a fallback call bills at the FALLBACK model's rate, not the primary model's — a spike here often explains a cost-side shift with no corresponding `usage_events` anomaly):
   ```sql
   select metadata->>'call_class' as call_class,
          metadata->>'from_model' as from_model,
          metadata->>'to_model' as to_model,
          count(*) as fallback_count
   from generation_logs
   where event_kind = 'model_fallback'
     and created_at >= '2026-08-01' and created_at < '2026-09-01'
   group by 1, 2, 3 order by 4 desc;
   ```

   **c. Per-day `usage_events` count vs. `generation_logs` count** (detects unrecorded calls — a day where OpenRouter's dashboard shows meaningfully more request volume than `usage_events` rows suggests a billed call that never got a `recordUsageEvent()` write):
   ```sql
   select
     (select count(*) from usage_events
        where created_at >= '2026-08-01' and created_at < '2026-09-01') as usage_events_count,
     (select count(*) from generation_logs
        where created_at >= '2026-08-01' and created_at < '2026-09-01') as generation_logs_count;
   ```

6. Record the outcome — date, range, both totals, discrepancy, verdict — in the audit log table at the bottom of this document.

## Material discrepancy threshold

**5%.**

Under 5% is accepted as rounding/timing skew — a request billed by OpenRouter at the boundary of the export window can land in a different day bucket than `usage_events.created_at` (UTC), which is enough to move a day's total without any real accounting error. At or above 5%, the audit fails and requires investigation (Procedure step 5) before the next billing period.

## Known sources of benign delta

An operator would otherwise rediscover these the hard way — check these before assuming a real accounting bug:

- **Critic re-roll costs (Phase 24)** are platform-side (the platform eats the cost of a rejected attempt) and appear in OpenRouter's total, but are excluded from the user's `charged_amount_micros` — expect `charged` to run below `cost` by roughly the re-roll rate, not the other way around.
- **Fallback-model calls (Phase 21)** bill at the fallback model's rate, which can differ meaningfully from the primary model's rate. A day with an elevated fallback rate will show a cost shift with no corresponding change in request volume.
- **Affiliate BYOK generations (Phase 21.1)** bill the AFFILIATE's own OpenRouter account, not the platform's. These must NOT appear in the platform OpenRouter dashboard total at all — if they do, that is itself a real finding (a BYOK routing regression), not a benign delta.
- **Day-boundary timezone skew** between `usage_events.created_at` (stored UTC) and the OpenRouter dashboard export (which may bucket by the dashboard viewer's local timezone) shifts a small number of requests near midnight into the adjacent day on one side but not the other.

## Audit log

| Date run | Range | `usage_events` total | OpenRouter total | Discrepancy | Verdict |
|---|---|---|---|---|---|
| *no audit has been run yet — see "When to run"* | | | | | |
