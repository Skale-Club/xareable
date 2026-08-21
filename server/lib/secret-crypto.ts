/**
 * Transparent encryption-at-rest for secret columns (Zernio `api_key` /
 * `webhook_secret` today — see server/services/zernio-credentials.service.ts).
 *
 * AES-256-GCM via `node:crypto` only — no new npm dependency, mirroring
 * server/lib/zernio.ts's "thin wrapper, no dependency" stance.
 *
 * Key source: the optional CREDENTIALS_ENCRYPTION_KEY env var (see
 * server/config/index.ts for the Zod validation). When it is unset, this
 * module degrades to a pass-through no-op so local dev and any deployment
 * that hasn't provisioned the key keep working exactly as before this
 * feature existed:
 *   - encryptSecret returns the plaintext unchanged (warns once).
 *   - decryptSecret already passes through anything not in the envelope
 *     format, which covers every legacy plaintext row regardless of whether
 *     the key is configured.
 *
 * Ciphertext envelope: a single self-describing string —
 *
 *   enc:v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>
 *
 * The "enc:v1:" prefix can never collide with a real Zernio API key or a
 * hex webhook secret, so decryptSecret can reliably distinguish "encrypted"
 * from "legacy plaintext" values by shape alone.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config/index.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // GCM-recommended 96-bit IV
const ENVELOPE_PREFIX = "enc:v1:";

let warnedNoKeyOnce = false;

/** Parse the configured 32-byte key, or null when encryption is not configured.
 * Deliberately re-parsed per call rather than memoized: `config` is frozen at
 * first import so the result never changes, and a 32-byte Buffer.from(hex) is
 * far cheaper than the AES operation it precedes — not worth caching a live
 * key material reference at module scope. */
function getEncryptionKey(): Buffer | null {
    const hex = config.CREDENTIALS_ENCRYPTION_KEY;
    if (!hex) return null;
    return Buffer.from(hex, "hex");
}

function warnNoKeyOnce(): void {
    if (warnedNoKeyOnce) return;
    warnedNoKeyOnce = true;
    console.warn(
        "[secret-crypto] CREDENTIALS_ENCRYPTION_KEY is not set — secrets " +
            "(Zernio api_key / webhook_secret) are being stored in PLAINTEXT. " +
            "Generate one with `openssl rand -hex 32` and set it as " +
            "CREDENTIALS_ENCRYPTION_KEY to enable encryption at rest.",
    );
}

/**
 * Encrypt a plaintext secret into the versioned envelope format.
 *
 * Returns the plaintext UNCHANGED (with a one-time console.warn) when
 * CREDENTIALS_ENCRYPTION_KEY is not configured — callers should always be
 * able to persist whatever this returns without special-casing.
 */
export function encryptSecret(plaintext: string): string {
    const key = getEncryptionKey();
    if (!key) {
        warnNoKeyOnce();
        return plaintext;
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return (
        ENVELOPE_PREFIX +
        [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
            ":",
        )
    );
}

/**
 * Decrypt a value previously produced by encryptSecret.
 *
 * - `null` in -> `null` out (mirrors nullable DB columns).
 * - Any value NOT in the `enc:v1:...` envelope format is returned AS-IS.
 *   This is what keeps existing plaintext rows working (pre-encryption data,
 *   or any row written while CREDENTIALS_ENCRYPTION_KEY was unset) and lets
 *   the system degrade safely if the env var is later unset — those rows
 *   simply pass through unchanged instead of being (mis)treated as
 *   ciphertext.
 * - A value that IS in envelope format but fails to decrypt (wrong/rotated
 *   key, or tampered data) THROWS — silently returning null here would look
 *   identical to "user has no key configured" and cause confusing
 *   downstream behavior (e.g. silently falling back to global mode, or a
 *   webhook signature check that quietly never verifies).
 */
export function decryptSecret(stored: string | null): string | null {
    if (stored == null) return null;
    if (!stored.startsWith(ENVELOPE_PREFIX)) return stored;

    const key = getEncryptionKey();
    if (!key) {
        throw new Error(
            "[secret-crypto] Cannot decrypt: value is in encrypted envelope format but " +
                "CREDENTIALS_ENCRYPTION_KEY is not set. If this key was previously configured " +
                "and has since been removed, restore it to decrypt existing rows.",
        );
    }

    const parts = stored.slice(ENVELOPE_PREFIX.length).split(":");
    if (parts.length !== 3) {
        throw new Error(
            "[secret-crypto] Cannot decrypt: malformed envelope (expected 3 base64 segments).",
        );
    }
    const [ivB64, authTagB64, ciphertextB64] = parts;

    try {
        const iv = Buffer.from(ivB64, "base64");
        const authTag = Buffer.from(authTagB64, "base64");
        const ciphertext = Buffer.from(ciphertextB64, "base64");

        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString("utf8");
    } catch (err) {
        throw new Error(
            "[secret-crypto] Failed to decrypt secret — most likely CREDENTIALS_ENCRYPTION_KEY " +
                "was rotated or is incorrect (a wrong key fails GCM auth-tag verification), or the " +
                "stored ciphertext was tampered with/truncated. Original error: " +
                (err instanceof Error ? err.message : String(err)),
        );
    }
}
