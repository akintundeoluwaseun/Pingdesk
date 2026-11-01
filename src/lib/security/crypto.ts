import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth refresh tokens.
 *
 * Format: v<keyVersion>:<iv hex>:<tag hex>:<ciphertext hex>
 * Keys:   TOKEN_ENCRYPTION_KEY       -> current key (version TOKEN_ENCRYPTION_KEY_VERSION, default 1)
 *         TOKEN_ENCRYPTION_KEY_V<n>  -> older keys kept only for decryption during rotation
 * Legacy values without a version prefix (from the first scaffold) decrypt with v1.
 */
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

function currentVersion(): number {
  const v = Number(process.env.TOKEN_ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(v) || v < 1) throw new Error("TOKEN_ENCRYPTION_KEY_VERSION must be a positive integer.");
  return v;
}

function keyFor(version: number): Buffer {
  const raw =
    version === currentVersion() ? process.env.TOKEN_ENCRYPTION_KEY : process.env[`TOKEN_ENCRYPTION_KEY_V${version}`];
  if (!raw || !HEX_KEY.test(raw)) {
    throw new Error(`Encryption key v${version} is missing or not 64 hex characters.`);
  }
  return Buffer.from(raw, "hex");
}

export function encryptSecret(value: string): { ciphertext: string; keyVersion: number } {
  const version = currentVersion();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(version), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: [`v${version}`, iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(":"),
    keyVersion: version,
  };
}

export function decryptSecret(value: string): string {
  const parts = value.split(":");
  let version = 1;
  if (parts.length === 4) {
    const m = /^v(\d+)$/.exec(parts[0]);
    if (!m) throw new Error("Invalid encrypted secret.");
    version = Number(m[1]);
    parts.shift();
  }
  const [iv, tag, data] = parts;
  if (parts.length !== 3 || !iv || !tag || !data) throw new Error("Invalid encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(version), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
}
