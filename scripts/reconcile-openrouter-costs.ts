/**
 * scripts/reconcile-openrouter-costs.ts
 *
 * POL-08, plan 26-05 — the operator-run OpenRouter cost reconciliation aid.
 *
 * WHAT THIS IS:
 *   A manual, operator-invoked reporting scaffold. It is deliberately NOT
 *   scheduled anywhere — not wired into CI, not wired into `node-cron`
 *   (`server/services/cleanup-cron.service.ts`), not wired into GitHub
 *   Actions (`.github/workflows/`), and never imported from `server/`.
 *   See docs/cost-reconciliation-runbook.md for the full audit procedure —
 *   this script is Step 1 of that procedure, nothing more.
 *
 * WHY MANUAL: the comparison side of the audit is the OpenRouter dashboard,
 * which has no API integration in this codebase (out of scope for POL-08).
 * A human has to open that dashboard and eyeball it against this script's
 * output — so there is nothing for a cron job to compare against here.
 *
 * SOURCE OF TRUTH: `usage_events.cost_usd_micros` is the PRIMARY source of
 * truth for real per-request OpenRouter cost (Phase 21 GATE-05). This script
 * queries `usage_events` ONLY. `generation_logs` (critic re-roll cost,
 * model-fallback rows) is the runbook's INVESTIGATION surface for explaining
 * a discrepancy AFTER one is found — it is never a second primary total, and
 * this script does not query it.
 *
 * Run:
 *   npx tsx scripts/reconcile-openrouter-costs.ts --from=2026-08-01 --to=2026-08-31
 *
 * --from / --to are inclusive ISO calendar dates (YYYY-MM-DD). When omitted,
 * both default to the previous full calendar UTC month.
 *
 * Safe to run with no Supabase credentials present (e.g. in a sandbox, or by
 * mistake): prints a clear message and exits 0 — this script never throws
 * and never exits non-zero for a missing-credentials run, mirroring
 * scripts/verify-critic-live.ts's no-key SKIP path.
 */
import { createAdminSupabase } from "../server/supabase.js";

type UsageEventRow = {
  created_at: string;
  event_type: "generate" | "edit" | "transcribe";
  text_model: string | null;
  image_model: string | null;
  cost_usd_micros: number | null;
  charged_amount_micros: number | null;
  platform_net_micros: number | null;
};

// ── Arg parsing — plain process.argv regex matching, this repo's convention
// (see scripts/verify-critic-live.ts's --image=/--model= parsing) — no
// argument-parsing dependency. ────────────────────────────────────────────
function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => new RegExp(`^--${flag}=(.+)$`).test(a));
  if (!arg) return undefined;
  return arg.match(new RegExp(`^--${flag}=(.+)$`))![1];
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Previous full calendar UTC month, computed from `now`. */
function previousCalendarMonthRange(now: Date): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed; current month
  const firstOfPrevMonth = new Date(Date.UTC(y, m - 1, 1));
  const lastOfPrevMonth = new Date(Date.UTC(y, m, 0)); // day 0 of current month = last day of prev month
  return { from: toIsoDate(firstOfPrevMonth), to: toIsoDate(lastOfPrevMonth) };
}

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00.000Z`).getTime());
}

const defaults = previousCalendarMonthRange(new Date());
const fromArg = argValue("from");
const toArg = argValue("to");
const fromDate = fromArg ?? defaults.from;
const toDate = toArg ?? defaults.to;

if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate)) {
  console.error(
    `Invalid --from/--to. Expected YYYY-MM-DD, got --from=${fromDate} --to=${toDate}.`,
  );
  console.error(
    "Usage: npx tsx scripts/reconcile-openrouter-costs.ts --from=2026-08-01 --to=2026-08-31",
  );
  process.exit(1);
}

// --from/--to are INCLUSIVE calendar dates. The DB query needs an exclusive
// upper bound so timestamps that fall anywhere within the --to day are
// still captured (a plain .lte(toDate) would silently drop everything
// after midnight on the last day).
const fromIso = `${fromDate}T00:00:00.000Z`;
const toExclusiveIso = new Date(
  new Date(`${toDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
).toISOString();

function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6)}`;
}

function formatRatio(chargedMicros: number, costMicros: number): string {
  if (costMicros <= 0) return "-";
  return `${(chargedMicros / costMicros).toFixed(2)}x`;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

async function main(): Promise<void> {
  // ── Missing-credentials path: never throw, always exit 0 ────────────────
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      "scripts/reconcile-openrouter-costs.ts: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.",
    );
    console.log(
      "This is a manual audit aid meant to be run by an operator against production credentials.",
    );
    console.log(
      "See docs/cost-reconciliation-runbook.md for the full procedure. Exiting cleanly (no data to report).",
    );
    process.exit(0);
  }

  console.log(
    `=== OpenRouter Cost Reconciliation (POL-08) — usage_events, ${fromDate}..${toDate} inclusive ===\n`,
  );

  const sb = createAdminSupabase();
  const rows: UsageEventRow[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  // ── Page through usage_events in blocks of 1000 until a short page returns.
  // Aggregation happens IN PROCESS — this codebase does not use Postgres RPC
  // for admin aggregates (mirrors server/routes/billing.routes.ts's own
  // in-process reduce over usage_events-derived rows). ────────────────────
  for (;;) {
    const { data, error } = await sb
      .from("usage_events")
      .select(
        "created_at, event_type, text_model, image_model, cost_usd_micros, charged_amount_micros, platform_net_micros",
      )
      .gte("created_at", fromIso)
      .lt("created_at", toExclusiveIso)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`usage_events query failed: ${error.message}`);
      process.exit(0); // still exit 0 — a query failure isn't this script's job to gate on
    }

    const page = (data ?? []) as UsageEventRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (rows.length === 0) {
    console.log(
      `No usage_events rows found for ${fromDate}..${toDate}. Nothing to reconcile for this range.`,
    );
    process.exit(0);
  }

  // ── Aggregate by day ──────────────────────────────────────────────────────
  const byDay = new Map<
    string,
    { count: number; costMicros: number; chargedMicros: number }
  >();
  // ── Aggregate by model (prefer image_model, fall back to text_model) ─────
  const byModel = new Map<string, { count: number; costMicros: number }>();

  let totalCount = 0;
  let totalCostMicros = 0;
  let totalChargedMicros = 0;
  let totalPlatformNetMicros = 0;

  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    const cost = row.cost_usd_micros ?? 0;
    const charged = row.charged_amount_micros ?? 0;
    const platformNet = row.platform_net_micros ?? 0;

    const dayEntry = byDay.get(day) ?? { count: 0, costMicros: 0, chargedMicros: 0 };
    dayEntry.count += 1;
    dayEntry.costMicros += cost;
    dayEntry.chargedMicros += charged;
    byDay.set(day, dayEntry);

    const modelSlug = row.image_model ?? row.text_model ?? "(unknown)";
    const modelEntry = byModel.get(modelSlug) ?? { count: 0, costMicros: 0 };
    modelEntry.count += 1;
    modelEntry.costMicros += cost;
    byModel.set(modelSlug, modelEntry);

    totalCount += 1;
    totalCostMicros += cost;
    totalChargedMicros += charged;
    totalPlatformNetMicros += platformNet;
  }

  // ── Table 1: by day ────────────────────────────────────────────────────
  console.log("--- By day ---");
  const dayRows = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, e]) => [
      day,
      String(e.count),
      formatUsd(e.costMicros),
      formatUsd(e.chargedMicros),
      formatRatio(e.chargedMicros, e.costMicros),
    ]);
  printTable(
    ["date", "events", "sum(cost_usd_micros)", "sum(charged_amount_micros)", "markup"],
    dayRows,
  );

  // ── Table 2: by model ──────────────────────────────────────────────────
  console.log("\n--- By model ---");
  const modelRows = Array.from(byModel.entries())
    .sort(([, a], [, b]) => b.costMicros - a.costMicros)
    .map(([model, e]) => [model, String(e.count), formatUsd(e.costMicros)]);
  printTable(["model", "events", "sum(cost_usd_micros)"], modelRows);

  // ── Table 3: grand total ───────────────────────────────────────────────
  console.log("\n--- Grand total ---");
  printTable(
    ["events", "total real cost (USD)", "total charged (USD)", "total platform net (USD)"],
    [[
      String(totalCount),
      formatUsd(totalCostMicros),
      formatUsd(totalChargedMicros),
      formatUsd(totalPlatformNetMicros),
    ]],
  );

  // ── NEXT STEP ──────────────────────────────────────────────────────────
  console.log("\n=== NEXT STEP ===");
  console.log(
    `1. Open the OpenRouter dashboard (Activity / Usage) for the SAME date range: ${fromDate}..${toDate}.`,
  );
  console.log(
    `2. Compare its total spend against the grand-total real cost above (${formatUsd(totalCostMicros)}).`,
  );
  console.log(
    "3. Apply docs/cost-reconciliation-runbook.md's material-discrepancy threshold to the result.",
  );
  console.log(
    "This script CANNOT fetch the OpenRouter dashboard side — there is no OpenRouter usage-API",
  );
  console.log(
    "integration in this codebase, and adding one is out of scope for POL-08. The comparison above",
  );
  console.log(
    "must be done by hand. If the discrepancy is over threshold, use the runbook's generation_logs",
  );
  console.log(
    "investigation queries (visual_critic re-roll cost, model_fallback rate) to explain it —",
  );
  console.log(
    "generation_logs is an investigation surface only, never a second primary cost total.",
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("reconcile-openrouter-costs.ts: unhandled error:", err);
  // Never exit non-zero from this manual aid — an operator re-runs it by hand.
  process.exit(0);
});
