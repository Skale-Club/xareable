// Functional test for TASK 1: the pure publish-outcome decision function
// (resolvePublishOutcome) that decides whether a publish attempt resolves an
// auto_post_items row to 'published' or 'failed' based on the PostPublication[]
// rows publishPost() returns — since publishPost() does NOT throw on a
// per-platform failure, this decision logic is the only thing standing
// between "every platform failed" and Autopilot silently reporting
// "published" anyway. No network, no DB. Run:
//   npx tsx scripts/test-autopost-publish-outcome.ts
import { resolvePublishOutcome } from "../server/services/autopost.service.js";
import type { PostPublication } from "../shared/schema.js";

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.error(`FAIL ${label}\n  expected: ${expectedStr}\n  actual:   ${actualStr}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

// ── Fixture builder ─────────────────────────────────────────────────────────

let idCounter = 0;

function publication(params: {
  platform: string;
  status: PostPublication["status"];
  error_message?: string | null;
}): PostPublication {
  idCounter += 1;
  const nowIso = new Date().toISOString();
  return {
    id: `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`,
    user_id: "00000000-0000-0000-0000-000000000001",
    post_id: "00000000-0000-0000-0000-000000000002",
    social_account_id: "00000000-0000-0000-0000-000000000003",
    platform: params.platform,
    mode: "global",
    zernio_post_id: null,
    status: params.status,
    platform_post_id: null,
    platform_post_url: null,
    error_message: params.error_message ?? null,
    scheduled_for: null,
    published_at: params.status === "published" ? nowIso : null,
    refresh_attempts: 0,
    last_refresh_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

// ── 1: empty publications ────────────────────────────────────────────────────

assertEqual(
  "resolvePublishOutcome([]) -> failed, no publication records",
  resolvePublishOutcome([]),
  { status: "failed", error_message: "Publish produced no publication records" },
);

// ── 2-3: all-failed ──────────────────────────────────────────────────────────

assertEqual(
  "resolvePublishOutcome([failed(instagram), failed(facebook)]) with distinct messages -> failed, deduped+joined",
  resolvePublishOutcome([
    publication({ platform: "instagram", status: "failed", error_message: "Token expired" }),
    publication({ platform: "facebook", status: "failed", error_message: "Rate limited" }),
  ]),
  { status: "failed", error_message: "Token expired; Rate limited" },
);

assertEqual(
  "resolvePublishOutcome([failed, failed]) with the SAME message -> failed, message deduped (not doubled)",
  resolvePublishOutcome([
    publication({ platform: "instagram", status: "failed", error_message: "Zernio unreachable" }),
    publication({ platform: "facebook", status: "failed", error_message: "Zernio unreachable" }),
  ]),
  { status: "failed", error_message: "Zernio unreachable" },
);

assertEqual(
  "resolvePublishOutcome([failed(no message), failed(no message)]) -> failed, generic fallback message",
  resolvePublishOutcome([
    publication({ platform: "instagram", status: "failed", error_message: null }),
    publication({ platform: "facebook", status: "failed", error_message: null }),
  ]),
  { status: "failed", error_message: "Publish failed on all target platforms" },
);

// ── 4: partial failure ───────────────────────────────────────────────────────

assertEqual(
  "resolvePublishOutcome([published(instagram), failed(facebook)]) -> published, warning names the failed platform",
  resolvePublishOutcome([
    publication({ platform: "instagram", status: "published" }),
    publication({ platform: "facebook", status: "failed", error_message: "Rate limited" }),
  ]),
  { status: "published", error_message: "Publish failed on: facebook" },
);

assertEqual(
  "resolvePublishOutcome([published, failed, failed]) with two distinct failed platforms -> published, both named",
  resolvePublishOutcome([
    publication({ platform: "instagram", status: "published" }),
    publication({ platform: "facebook", status: "failed", error_message: "Rate limited" }),
    publication({ platform: "tiktok", status: "failed", error_message: "Unsupported media" }),
  ]),
  { status: "published", error_message: "Publish failed on: facebook, tiktok" },
);

// ── 5: no failures at all (published/pending/scheduled mix) ─────────────────

assertEqual(
  "resolvePublishOutcome([published]) -> published, error_message null",
  resolvePublishOutcome([publication({ platform: "instagram", status: "published" })]),
  { status: "published", error_message: null },
);

assertEqual(
  "resolvePublishOutcome([pending, scheduled]) -> published, error_message null (no 'failed' rows at all)",
  resolvePublishOutcome([
    publication({ platform: "instagram", status: "pending" }),
    publication({ platform: "facebook", status: "scheduled" }),
  ]),
  { status: "published", error_message: null },
);

// ── 6: message length cap ────────────────────────────────────────────────────

{
  const longMessage = "x".repeat(3000);
  const result = resolvePublishOutcome([
    publication({ platform: "instagram", status: "failed", error_message: longMessage }),
  ]);
  assertEqual("resolvePublishOutcome([failed(very long message)]) -> failed", result.status, "failed");
  assertEqual(
    "resolvePublishOutcome([failed(very long message)]) -> error_message capped at 2000 chars",
    result.error_message?.length,
    2000,
  );
}

console.log("\nAll TASK 1 publish-outcome decision tests passed.");
