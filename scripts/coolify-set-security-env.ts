/**
 * Audit + push the two SECURITY-LOAD-BEARING environment variables to Coolify.
 *
 * Companion to coolify-set-r2-env.ts, same conventions (token from YOUR shell,
 * secrets never printed, idempotent PATCH/POST, --check for a read-only audit).
 * Split into its own script because these two vars behave differently from the
 * R2 block:
 *
 *   APP_URL                    - NOT read from local .env. Its correct value
 *                                DIFFERS between local dev and production
 *                                (localhost vs the public origin), so blindly
 *                                mirroring .env - the way the R2 script can -
 *                                would push a localhost URL to production. The
 *                                expected production value is fixed below.
 *                                Load-bearing: getCanonicalOrigin() builds the
 *                                Zernio webhook registration URL (registered
 *                                TOGETHER WITH its HMAC signing secret) and the
 *                                OAuth redirect from it. Unset, both fall back
 *                                to trusting the request's Host header.
 *
 *   CREDENTIALS_ENCRYPTION_KEY - read from local .env (which doubles as the
 *                                backup copy). Enables AES-256-GCM encryption
 *                                at rest for user_zernio_settings.api_key and
 *                                .webhook_secret. Validated as exactly 64 hex
 *                                chars BEFORE any write, because a malformed
 *                                key that reached production would throw on
 *                                every decrypt.
 *
 * ROTATION WARNING: changing CREDENTIALS_ENCRYPTION_KEY makes every row already
 * encrypted with the old key permanently undecryptable. This script refuses to
 * overwrite an existing, different key on Coolify unless --force is passed.
 *
 * Usage (token stays in your shell, never in argv or shell history):
 *
 *   read -s COOLIFY_TOKEN && export COOLIFY_TOKEN
 *   npx tsx scripts/coolify-set-security-env.ts --check   # read-only audit
 *   npx tsx scripts/coolify-set-security-env.ts           # write
 *
 * Env changes only take effect on the next deploy/restart.
 */

import * as dotenv from "dotenv";

dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);

const COOLIFY_BASE = process.env.COOLIFY_BASE ?? "https://coolify.skale.club";
const APP_UUID = process.env.COOLIFY_APP_UUID ?? "emitz765i1dvk4a89ofshjhz";
const TOKEN = process.env.COOLIFY_TOKEN;
const CHECK_ONLY = process.argv.includes("--check");
const FORCE = process.argv.includes("--force");

/** The canonical public origin for production (see CLAUDE.md "Deployment & Cron"). */
const EXPECTED_APP_URL = "https://xareable.com";

const SECRET_KEYS = new Set(["CREDENTIALS_ENCRYPTION_KEY"]);

interface CoolifyEnv {
    uuid: string;
    key: string;
    value: string;
}

function describe(key: string, value: string | undefined): string {
    if (!value) return "(missing)";
    return SECRET_KEYS.has(key) ? `${value.length} chars` : value;
}

function fail(message: string): never {
    console.error(`\n[FAIL] ${message}\n`);
    process.exit(1);
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${COOLIFY_BASE}/api/v1${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(init.headers ?? {}),
        },
    });
}

async function main(): Promise<void> {
    if (!TOKEN) {
        fail(
            "COOLIFY_TOKEN is not set.\n\n" +
                "  read -s COOLIFY_TOKEN && export COOLIFY_TOKEN\n" +
                "  npx tsx scripts/coolify-set-security-env.ts --check",
        );
    }

    const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    if (!encryptionKey) {
        fail(
            "CREDENTIALS_ENCRYPTION_KEY is missing from the local .env.\n" +
                "Generate one:  openssl rand -hex 32",
        );
    }
    if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
        fail(
            `CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hex chars (got ${encryptionKey.length}). ` +
                "A malformed key would throw on every decrypt in production.",
        );
    }

    const desired: Record<string, string> = {
        APP_URL: EXPECTED_APP_URL,
        CREDENTIALS_ENCRYPTION_KEY: encryptionKey,
    };
    const keys = Object.keys(desired);

    console.log(`Coolify : ${COOLIFY_BASE}`);
    console.log(`App     : ${APP_UUID}`);
    console.log(`Mode    : ${CHECK_ONLY ? "CHECK (read-only)" : "WRITE"}\n`);

    const listRes = await api(`/applications/${APP_UUID}/envs`);
    if (!listRes.ok) {
        fail(
            `Could not list env vars (HTTP ${listRes.status}). ` +
                "Check the token has access to this application.",
        );
    }
    const existing = (await listRes.json()) as CoolifyEnv[];
    const byKey = new Map(existing.map((e) => [e.key, e]));
    console.log(`Application currently has ${existing.length} env vars.\n`);

    if (CHECK_ONLY) {
        let drift = 0;
        for (const key of keys) {
            const remote = byKey.get(key);
            if (!remote || !remote.value) {
                console.log(`  [X]  ${key.padEnd(28)} ABSENT on Coolify`);
                drift++;
            } else if (remote.value === desired[key]) {
                console.log(`  [ok] ${key.padEnd(28)} matches   ${describe(key, remote.value)}`);
            } else {
                console.log(
                    `  [!]  ${key.padEnd(28)} DIFFERS   ` +
                        (SECRET_KEYS.has(key)
                            ? `(coolify ${remote.value.length} chars, local ${desired[key].length})`
                            : `coolify="${remote.value}" expected="${desired[key]}"`),
                );
                drift++;
            }
        }
        console.log(
            drift === 0
                ? "\n[ok] Both security vars are set correctly on Coolify."
                : `\n[!] ${drift} of ${keys.length} need attention - re-run without --check.`,
        );
        process.exit(drift === 0 ? 0 : 1);
    }

    let created = 0;
    let updated = 0;

    for (const key of keys) {
        const value = desired[key];
        const remote = byKey.get(key);

        if (remote && remote.value === value) {
            console.log(`  [=] ${key.padEnd(28)} already correct  ${describe(key, value)}`);
            continue;
        }

        // Guard the one genuinely destructive case: replacing a DIFFERENT
        // encryption key that is already in use makes existing encrypted rows
        // permanently undecryptable.
        if (remote && remote.value && SECRET_KEYS.has(key) && !FORCE) {
            fail(
                `${key} already exists on Coolify with a DIFFERENT value.\n` +
                    "Overwriting it makes every already-encrypted row permanently undecryptable.\n" +
                    "If you are certain (e.g. nothing is encrypted yet), re-run with --force.",
            );
        }

        const res = await api(`/applications/${APP_UUID}/envs`, {
            method: remote ? "PATCH" : "POST",
            body: JSON.stringify({
                key,
                value,
                is_preview: false,
                // Literal so Coolify never expands a `$` inside a secret.
                is_literal: true,
                is_multiline: false,
            }),
        });

        if (!res.ok) {
            const detail = await res.text();
            fail(`${key}: HTTP ${res.status} - ${detail.slice(0, 200)}`);
        }

        if (remote) {
            updated++;
            console.log(`  [~] ${key.padEnd(28)} updated  ${describe(key, value)}`);
        } else {
            created++;
            console.log(`  [+] ${key.padEnd(28)} created  ${describe(key, value)}`);
        }
    }

    console.log(`\n${created} created, ${updated} updated.`);
    console.log("Env changes apply on the next deploy or restart.");
    console.log("Verify:  npx tsx scripts/coolify-set-security-env.ts --check");
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
