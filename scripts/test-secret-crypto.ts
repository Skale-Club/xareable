// Functional test for server/lib/secret-crypto.ts: AES-256-GCM
// encrypt/decrypt round-trip, random-IV non-determinism, legacy-plaintext
// pass-through, tamper detection, and unset-key pass-through behavior. No
// test framework, no network, no DB. Run:
//   npx tsx scripts/test-secret-crypto.ts
//
// Why this spawns child processes instead of just re-importing the module:
// server/config/index.ts computes its `config` export ONCE, at module
// import time, from whatever process.env holds right then. secret-crypto.ts
// reads config.CREDENTIALS_ENCRYPTION_KEY lazily per-call, but the `config`
// object itself is a frozen singleton — Node's ESM module cache means a
// second `import("../server/config/index.js")` from the *same process*
// returns that same frozen object, so flipping process.env mid-process
// would not actually change what secret-crypto.ts sees. Each of the three
// key-configuration states this test needs (a real key, a *different* key,
// and no key at all) therefore gets its own fresh child process, each with
// its own environment.
//
// This file plays both roles: with no CLI arg it's the orchestrator (what
// `npx tsx scripts/test-secret-crypto.ts` runs); with a phase name as
// argv[2] it's a worker that runs just that phase's assertions against a
// freshly-booted config/secret-crypto pair and exits 0/1.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

// Deterministic 32-byte (64 hex char) test keys — NOT real secrets.
const TEST_KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

// Dummy-but-valid values for the OTHER required env vars in server/config/index.ts
// (SUPABASE_URL etc. have no .optional()). Without these, validateEnv()'s
// non-production fallback path kicks in and silently drops
// CREDENTIALS_ENCRYPTION_KEY from the parsed config entirely — which would
// make every phase below look like "key unset" regardless of what we pass.
const BASE_ENV = {
  SUPABASE_URL: "https://test-project.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

function assert(label: string, condition: boolean): void {
  if (!condition) {
    console.error(`FAIL ${label}`);
    process.exit(1);
  }
  console.log(`PASS ${label}`);
}

function assertThrows(label: string, fn: () => unknown): void {
  try {
    fn();
    console.error(`FAIL ${label} (expected a throw, got none)`);
    process.exit(1);
  } catch {
    console.log(`PASS ${label}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Worker mode: argv[2] is "phaseA" | "phaseB" | "phaseC"
// ─────────────────────────────────────────────────────────────────────────

async function runWorker(phase: string): Promise<void> {
  const { encryptSecret, decryptSecret } = await import("../server/lib/secret-crypto.js");

  if (phase === "phaseA") {
    // Key configured (TEST_KEY): round-trip, random IV, pass-through, tamper detection.
    const plaintext = "zk_live_abc123secretvalue";

    const ciphertext1 = encryptSecret(plaintext);
    assert("encryptSecret output uses the enc:v1: envelope prefix", ciphertext1.startsWith("enc:v1:"));
    assert("encryptSecret output differs from the plaintext", ciphertext1 !== plaintext);
    assert("decryptSecret(encryptSecret(x)) === x (round-trip)", decryptSecret(ciphertext1) === plaintext);

    const ciphertext2 = encryptSecret(plaintext);
    assert(
      "two encryptions of the same plaintext produce different ciphertext (random IV)",
      ciphertext1 !== ciphertext2,
    );
    assert("...but both still decrypt back to the same plaintext", decryptSecret(ciphertext2) === plaintext);

    // Deliberately NOT prefixed "sk-": a realistic-looking key prefix trips
    // gitleaks's openai-api-key rule, and a scanner that cries wolf on test
    // fixtures is a scanner people start ignoring. The prefix is irrelevant to
    // what this asserts — only "does not start with the enc:v1: envelope" is.
    const legacyValue = "legacy-plaintext-key-never-encrypted";
    assert(
      "decryptSecret passes through a legacy/non-envelope plaintext value unchanged",
      decryptSecret(legacyValue) === legacyValue,
    );
    assert("decryptSecret(null) === null", decryptSecret(null) === null);

    const tampered = ciphertext1.slice(0, -4) + "XXXX";
    assertThrows("decryptSecret throws on a tampered ciphertext", () => decryptSecret(tampered));
    assertThrows(
      "decryptSecret throws on a malformed envelope (missing segments)",
      () => decryptSecret("enc:v1:only-one-segment"),
    );

    // Hand the valid ciphertext to the orchestrator so phaseB/phaseC can
    // reuse it for the cross-key and key-unset scenarios.
    console.log(`CIPHERTEXT=${ciphertext1}`);
    return;
  }

  if (phase === "phaseB") {
    // A DIFFERENT key configured than the one that produced FIXTURE_CIPHERTEXT:
    // must throw (rotated/incorrect key), never silently return null.
    const fixture = process.env.FIXTURE_CIPHERTEXT;
    if (!fixture) throw new Error("phaseB requires FIXTURE_CIPHERTEXT");
    assertThrows(
      "decryptSecret throws when the configured key doesn't match the one used to encrypt (rotated key)",
      () => decryptSecret(fixture),
    );
    return;
  }

  if (phase === "phaseC") {
    // CREDENTIALS_ENCRYPTION_KEY unset entirely: pass-through, no crash —
    // except an already-encrypted envelope value, which must still throw
    // rather than silently returning null (that would look like "no key
    // configured" and cause confusing downstream behavior).
    const plaintext = "zk_live_abc123secretvalue";
    const fixture = process.env.FIXTURE_CIPHERTEXT;
    if (!fixture) throw new Error("phaseC requires FIXTURE_CIPHERTEXT");

    const result = encryptSecret(plaintext);
    assert(
      "encryptSecret returns the plaintext unchanged when CREDENTIALS_ENCRYPTION_KEY is unset",
      result === plaintext,
    );
    assert(
      "decryptSecret passes through a plain value unchanged when the key is unset",
      decryptSecret(plaintext) === plaintext,
    );
    assertThrows(
      "decryptSecret throws on an envelope-format value when the key is unset",
      () => decryptSecret(fixture),
    );
    return;
  }

  throw new Error(`Unknown phase: ${phase}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestrator mode: no argv[2]
// ─────────────────────────────────────────────────────────────────────────

function runChild(phase: string, envOverrides: Record<string, string | undefined>): string {
  const env: Record<string, string | undefined> = { ...process.env, ...BASE_ENV, ...envOverrides };
  if (envOverrides.CREDENTIALS_ENCRYPTION_KEY === undefined) {
    delete env.CREDENTIALS_ENCRYPTION_KEY;
  }
  try {
    return execSync(`npx tsx "${THIS_FILE}" ${phase}`, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    const out = (err as { stdout?: string }).stdout;
    if (out) process.stdout.write(out);
    console.error(`\nFAIL orchestrator: ${phase} child process failed`);
    process.exit(1);
  }
}

function runOrchestrator(): void {
  const outA = runChild("phaseA", { CREDENTIALS_ENCRYPTION_KEY: TEST_KEY });
  process.stdout.write(outA);

  const match = outA.match(/^CIPHERTEXT=(.+)$/m);
  if (!match) {
    console.error("FAIL orchestrator: phaseA did not emit a CIPHERTEXT fixture line");
    process.exit(1);
  }
  const fixtureCiphertext = match[1];

  const outB = runChild("phaseB", {
    CREDENTIALS_ENCRYPTION_KEY: OTHER_KEY,
    FIXTURE_CIPHERTEXT: fixtureCiphertext,
  });
  process.stdout.write(outB);

  const outC = runChild("phaseC", {
    CREDENTIALS_ENCRYPTION_KEY: undefined,
    FIXTURE_CIPHERTEXT: fixtureCiphertext,
  });
  process.stdout.write(outC);

  console.log("\nAll secret-crypto tests passed.");
}

// ─────────────────────────────────────────────────────────────────────────

const phaseArg = process.argv[2];
if (phaseArg) {
  runWorker(phaseArg).catch((err) => {
    console.error("FAIL unexpected exception in worker:", err);
    process.exit(1);
  });
} else {
  runOrchestrator();
}
