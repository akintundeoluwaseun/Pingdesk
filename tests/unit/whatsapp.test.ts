import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { fromWaId, toE164 } from "@/lib/whatsapp/phone";
import { classifyMetaError, cleanParam, metaClient, otpComponents, MetaError } from "@/lib/whatsapp/meta";
import { alertComponents, decide, failureOutcome, formatAlertTime, POLICY, retryAt, type ClaimedNotification } from "@/server/delivery/decide";
import { parseWebhook, verifySignature } from "@/server/whatsapp/webhook";
import { generateCode, hashCode } from "@/server/whatsapp/verification";

const now = new Date("2026-11-01T10:00:00Z");
const base: ClaimedNotification = {
  id: "n1",
  user_id: "u1",
  category: "buyer_message",
  inbox_label: "Fiverr seller",
  received_at: "2026-11-01T09:55:00Z",
  delivery_attempts: 0,
  timezone: "Africa/Lagos",
  alerts_paused: false,
  category_enabled: true,
  phone_e164: "+2348031234567",
  whatsapp_status: "verified",
  sent_last_hour: 0,
};

describe("phone numbers", () => {
  it("normalises international and Nigerian local formats", () => {
    expect(toE164("+234 803 123 4567")).toBe("+2348031234567");
    expect(toE164("0803 123 4567")).toBe("+2348031234567");
    expect(toE164("002348031234567")).toBe("+2348031234567");
    expect(toE164("+44 7400 123456")).toBe("+447400123456");
  });
  it("rejects junk", () => {
    for (const bad of ["", "123", "+234 1", "hello", "+999 123 456 789"]) expect(toE164(bad), bad).toBeNull();
  });
  it("converts wa_id", () => {
    expect(fromWaId("2348031234567")).toBe("+2348031234567");
    expect(fromWaId("abc")).toBeNull();
  });
});

describe("delivery decisions", () => {
  it("sends verified, enabled, fresh alerts", () => {
    const d = decide(base, now);
    expect(d.action).toBe("send");
  });
  it("skips paused, disabled, unverified/opted-out and stale", () => {
    expect(decide({ ...base, alerts_paused: true }, now)).toEqual({ action: "skip", reason: "paused" });
    expect(decide({ ...base, category_enabled: false }, now)).toEqual({ action: "skip", reason: "preference_off" });
    expect(decide({ ...base, whatsapp_status: "opted_out" }, now)).toEqual({ action: "skip", reason: "no_whatsapp" });
    expect(decide({ ...base, whatsapp_status: null, phone_e164: null }, now)).toEqual({ action: "skip", reason: "no_whatsapp" });
    expect(decide({ ...base, received_at: "2026-11-01T03:00:00Z" }, now)).toEqual({ action: "skip", reason: "stale" });
  });
  it("defers when the per-user hourly cap is hit", () => {
    const d = decide({ ...base, sent_last_hour: POLICY.maxPerUserPerHour }, now);
    expect(d).toEqual({ action: "defer", until: new Date("2026-11-01T10:15:00Z") });
  });
});

describe("alert template content", () => {
  it("contains only category, inbox label and local time", () => {
    const [body] = alertComponents({ ...base, inbox_label: "My\nInbox    with spaces" });
    expect(body.parameters.map((p) => p.text)).toEqual(["New buyer message", "My Inbox with spaces", formatAlertTime(base.received_at, "Africa/Lagos")]);
    expect(formatAlertTime(base.received_at, "Africa/Lagos")).toMatch(/1 Nov, 10:55/);
    expect(formatAlertTime(base.received_at, "Not/AZone")).toMatch(/09:55/);
  });
  it("cleans parameters", () => {
    expect(cleanParam("a\tb\r\nc")).toBe("a b c");
    expect(cleanParam("x".repeat(80), 10)).toHaveLength(10);
    expect(cleanParam("   ")).toBe("—");
  });
});

describe("retries", () => {
  it("backs off exponentially, capped at 6h", () => {
    const r = (n: number) => retryAt(n, now, () => 0).getTime() - now.getTime();
    expect(r(1)).toBe(60_000);
    expect(r(3)).toBe(240_000);
    expect(r(20)).toBe(6 * 3600_000);
  });
  it("retries retryable errors until the attempt limit", () => {
    const tmp = new MetaError(131000, "x", true, false, 500);
    expect(failureOutcome(tmp, 1, now).outcome).toBe("retry");
    expect(failureOutcome(tmp, POLICY.maxAttempts, now).outcome).toBe("failed");
    expect(failureOutcome(new MetaError(131026, "undeliverable", false, false, 400), 1, now).outcome).toBe("failed");
  });
  it("classifies Meta errors", () => {
    expect(classifyMetaError(400, { error: { code: 131026, message: "Message undeliverable" } })).toMatchObject({ retryable: false, operator: false });
    expect(classifyMetaError(400, { error: { code: 132001, message: "Template does not exist" } })).toMatchObject({ retryable: false, operator: true });
    expect(classifyMetaError(400, { error: { code: 190, message: "token expired" } })).toMatchObject({ operator: true });
    expect(classifyMetaError(429, { error: { code: 130429, message: "rate" } })).toMatchObject({ retryable: true });
    expect(classifyMetaError(502, "bad gateway")).toMatchObject({ retryable: true, code: null });
  });
});

describe("Meta client", () => {
  it("sends template payloads and returns the message id", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ messaging_product: "whatsapp", to: "2348031234567", type: "template", template: { name: "pingdesk_alert", language: { code: "en" } } });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    });
    const c = metaClient({ phoneNumberId: "123", accessToken: "t", apiVersion: "v26.0" }, fetchImpl as unknown as typeof fetch);
    expect(await c.sendTemplate("+2348031234567", "pingdesk_alert", "en", alertComponents(base))).toEqual({ messageId: "wamid.X" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://graph.facebook.com/v26.0/123/messages");
  });
  it("throws classified errors and treats network failure as retryable", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { code: 132001, message: "no template" } }), { status: 404 }));
    const c = metaClient({ phoneNumberId: "1", accessToken: "t", apiVersion: "v26.0" }, bad as unknown as typeof fetch);
    await expect(c.sendTemplate("+1", "x", "en", [])).rejects.toMatchObject({ code: 132001, operator: true });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const d = metaClient({ phoneNumberId: "1", accessToken: "t", apiVersion: "v26.0" }, down as unknown as typeof fetch);
    await expect(d.sendText("+1", "hi")).rejects.toMatchObject({ retryable: true });
  });
  it("builds the copy-code OTP components", () => {
    expect(otpComponents("123456")).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]);
  });
});

describe("verification codes", () => {
  it("generates 6-digit codes and user-bound hashes", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
    const key = "c".repeat(64);
    expect(hashCode("u1", "123456", key)).toBe(hashCode("u1", "123456", key));
    expect(hashCode("u1", "123456", key)).not.toBe(hashCode("u2", "123456", key));
    expect(hashCode("u1", "123456", key)).not.toContain("123456");
    expect(() => hashCode("u1", "1", "short")).toThrow();
  });
});

describe("webhook", () => {
  const secret = "app-secret";
  it("verifies Meta signatures", () => {
    const body = '{"a":1}';
    const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body + " ", sig, secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=00", secret)).toBe(false);
  });

  it("parses statuses and STOP/START replies", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                statuses: [
                  { id: "wamid.1", status: "delivered", timestamp: "1793530000", pricing: { category: "utility", billable: true } },
                  { id: "wamid.2", status: "failed", timestamp: "1793530001", errors: [{ code: 131026, title: "Message undeliverable" }] },
                  { id: "wamid.3", status: "weird" },
                ],
                messages: [
                  { from: "2348031234567", type: "text", text: { body: " stop " } },
                  { from: "2348031234567", type: "text", text: { body: "Start!" } },
                  { from: "2348031234567", type: "text", text: { body: "hello" } },
                  { from: "not-a-number", type: "text", text: { body: "STOP" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const { statuses, inbound } = parseWebhook(payload);
    expect(statuses.map((s) => [s.providerMessageId, s.status, s.errorCode])).toEqual([
      ["wamid.1", "delivered", null],
      ["wamid.2", "failed", 131026],
    ]);
    expect(statuses[0]).toMatchObject({ pricingCategory: "utility", billable: true, at: new Date(1793530000 * 1000).toISOString() });
    expect(inbound.map((m) => m.action)).toEqual(["stop", "start", "message"]);
  });

  it("ignores other objects", () => {
    expect(parseWebhook({ object: "page" })).toEqual({ statuses: [], inbound: [] });
    expect(parseWebhook(null)).toEqual({ statuses: [], inbound: [] });
  });
});
