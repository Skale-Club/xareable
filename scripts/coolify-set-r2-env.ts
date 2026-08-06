/**
 * Push the R2_* environment block from the local .env into Coolify.
 *
 * Why a script instead of the Coolify UI: five variables, two of them secrets,
 * typed by hand into a web form is exactly how a trailing space or a truncated
 * key ends up in production. This reads the values that are already proven
 * working locally and writes them verbatim.
 *
 * Secrets never reach stdout: every log line shows the key name and the value's
 * length, never the value. Safe to run with someone watching your screen, and
 * safe to paste the output into a chat.
 *
 * Idempotent — existing keys are PATCHed, missing ones POSTed. Re-running after
 * a partial failure is fine.
 *
 * Usage (the token stays in YOUR shell; it is read from the environment, never
 * passed as an argument, so it does not land in shell history):
 *
 *   read -s COOLIFY_TOKEN && export COOLIFY_TOKEN
 *   npx tsx scripts/coolify-set-r2-env.ts
 *
 * Then verify without writing anything:
 *
 *   npx tsx scripts/coolify-set-r2-env.ts --check
 *
 * Env changes only take effect on the next deploy/restart.
 */

import * as dotenv from "dotenv";

dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);

const COOLIFY_BASE = process.env.COOLIFY_BASE ?? "https://coolify.skale.club";
const APP_UUID = process.env.COOLIFY_APP_UUID ?? "emitz765i1dvk4a89ofshjhz";
const TOKEN = process.env.COOLIFY_TOKEN;
const CHECK_ONLY = process.argv.includes("--check");

const KEYS = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
] as const;

/** Values that are not secret and are safe to echo in full. */
const PUBLIC_KEYS = new Set(["R2_BUCKET", "R2_PUBLIC_BASE_URL"]);

function describe(key: string, value: string | undefined): string {
    if (!value) return "(missing)";
    return PUBLIC_KEYS.has(key) ? value : `${value.length} chars`;
}

function fail(message: string): never {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
}

interface CoolifyEnv {
    uuid: string;
    key: string;
    value: string;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${COOLIFY_BASE}/api/v1${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(init.headers ?? {}),
        },
    });
    return res;
}

async function main(): Promise<void> {
    if (!TOKEN) {
        fail(
            "COOLIFY_TOKEN is not set.\n\n" +
            "  read -s COOLIFY_TOKEN && export COOLIFY_TOKEN\n" +
            "  npx tsx scripts/coolify-set-r2-env.ts",
        );
    }

    const local: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of KEYS) {
        const value = process.env[key];
        if (!value) missing.push(key);
        else local[key] = value;
    }
    if (missing.length > 0) {
        fail(`Missing from local .env: ${missing.join(", ")}`);
    }

    console.log(`Coolify : ${COOLIFY_BASE}`);
    console.log(`App     : ${APP_UUID}`);
    console.log(`Mode    : ${CHECK_ONLY ? "CHECK (read-only)" : "WRITE"}\n`);

    const listRes = await api(`/applications/${APP_UUID}/envs`);
    if (!listRes.ok) {
        fail(
            `Could not list env vars (HTTP ${listRes.status}). ` +
            `Check the token has access to this application.`,
        );
    }
    const existing = (await listRes.json()) as CoolifyEnv[];
    const byKey = new Map(existing.map((e) => [e.key, e]));

    console.log(`Application currently has ${existing.length} env vars.\n`);

    if (CHECK_ONLY) {
        let drift = 0;
        for (const key of KEYS) {
            const remote = byKey.get(key);
            if (!remote) {
                console.log(`  ✗ ${key.padEnd(22)} absent on Coolify`);
                drift++;
            } else if (remote.value !== local[key]) {
                // Compare without revealing either side.
                console.log(
                    `  ✗ ${key.padEnd(22)} differs from .env ` +
                    `(coolify ${remote.value.length} chars, local ${local[key].length})`,
                );
                drift++;
            } else {
                console.log(`  ✓ ${key.padEnd(22)} matches .env  ${describe(key, remote.value)}`);
            }
        }
        console.log(
            drift === 0
                ? "\n✓ All five R2 vars on Coolify match the local .env."
                : `\n⚠ ${drift} of ${KEYS.length} need attention — re-run without --check.`,
        );
        process.exit(drift === 0 ? 0 : 1);
    }

    let created = 0;
    let updated = 0;

    for (const key of KEYS) {
        const value = local[key];
        const remote = byKey.get(key);

        if (remote && remote.value === value) {
            console.log(`  = ${key.padEnd(22)} already correct  ${describe(key, value)}`);
            continue;
        }

        const body = JSON.stringify({
            key,
            value,
            is_preview: false,
            // Literal so Coolify never tries to expand a `$` inside a secret.
            is_literal: true,
            is_multiline: false,
        });

        const res = await api(`/applications/${APP_UUID}/envs`, {
            method: remote ? "PATCH" : "POST",
            body,
        });

        if (!res.ok) {
            const detail = await res.text();
            fail(`${key}: HTTP ${res.status} — ${detail.slice(0, 200)}`);
        }

        if (remote) {
            updated++;
            console.log(`  ↻ ${key.padEnd(22)} updated  ${describe(key, value)}`);
        } else {
            created++;
            console.log(`  + ${key.padEnd(22)} created  ${describe(key, value)}`);
        }
    }

    console.log(`\n${created} created, ${updated} updated.`);
    console.log("Env changes apply on the next deploy or restart.");
    console.log("Verify any time with:  npx tsx scripts/coolify-set-r2-env.ts --check");
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
