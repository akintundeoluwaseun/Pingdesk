import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { createOAuthState, verifyOAuthState } from "@/lib/security/oauth-state";
import { revokeGoogleToken } from "@/lib/google/oauth";

const K1 = "a".repeat(64);
const K2 = "b".repeat(64);

describe("token encryption", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", K1);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_VERSION", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips and never contains the plaintext", () => {
    const { ciphertext, keyVersion } = encryptSecret("1//refresh-token");
    expect(keyVersion).toBe(1);
    expect(ciphertext.startsWith("v1:")).toBe(true);
    expect(ciphertext).not.toContain("refresh");
    expect(decryptSecret(ciphertext)).toBe("1//refresh-token");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x").ciphertext).not.toBe(encryptSecret("x").ciphertext);
  });

  it("detects tampering", () => {
    const { ciphertext } = encryptSecret("secret");
    const parts = ciphertext.split(":");
    parts[3] = (parts[3][0] === "0" ? "1" : "0") + parts[3].slice(1);
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("supports key rotation", () => {
    const old = encryptSecret("old-token").ciphertext;
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", K2);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_VERSION", "2");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_V1", K1);
    expect(decryptSecret(old)).toBe("old-token");
    expect(encryptSecret("new").ciphertext.startsWith("v2:")).toBe(true);
  });

  it("decrypts legacy unversioned values from the first scaffold", () => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Buffer.from(K1, "hex"), iv);
    const data = Buffer.concat([c.update("legacy", "utf8"), c.final()]);
    const legacy = [iv.toString("hex"), c.getAuthTag().toString("hex"), data.toString("hex")].join(":");
    expect(decryptSecret(legacy)).toBe("legacy");
  });

  it("rejects malformed keys", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "short");
    expect(() => encryptSecret("x")).toThrow(/64 hex/);
  });
});

describe("OAuth state", () => {
  const secret = "s".repeat(40);

  it("accepts the matching nonce for the same user", async () => {
    const { nonce, cookie } = await createOAuthState("user-1", secret);
    expect(await verifyOAuthState({ cookie, returnedState: nonce, userId: "user-1", secret })).toBe(true);
  });

  it("rejects a different user, nonce, secret or missing cookie", async () => {
    const { nonce, cookie } = await createOAuthState("user-1", secret);
    expect(await verifyOAuthState({ cookie, returnedState: nonce, userId: "user-2", secret })).toBe(false);
    expect(await verifyOAuthState({ cookie, returnedState: "other", userId: "user-1", secret })).toBe(false);
    expect(await verifyOAuthState({ cookie, returnedState: nonce, userId: "user-1", secret: "x".repeat(40) })).toBe(false);
    expect(await verifyOAuthState({ cookie: undefined, returnedState: nonce, userId: "user-1", secret })).toBe(false);
  });

  it("rejects expired state", async () => {
    vi.useFakeTimers();
    const { nonce, cookie } = await createOAuthState("user-1", secret);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await verifyOAuthState({ cookie, returnedState: nonce, userId: "user-1", secret })).toBe(false);
    vi.useRealTimers();
  });
});

describe("Google token revocation", () => {
  it("treats 200 and already-revoked as success, other failures as failure", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await revokeGoogleToken("t", ok as unknown as typeof fetch)).toBe(true);
    const gone = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 }));
    expect(await revokeGoogleToken("t", gone as unknown as typeof fetch)).toBe(true);
    const bad = vi.fn(async () => new Response("", { status: 503 }));
    expect(await revokeGoogleToken("t", bad as unknown as typeof fetch)).toBe(false);
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await revokeGoogleToken("t", down as unknown as typeof fetch)).toBe(false);
  });
});
