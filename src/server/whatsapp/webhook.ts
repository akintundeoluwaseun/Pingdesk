import { createHmac, timingSafeEqual } from "node:crypto";
import { fromWaId } from "@/lib/whatsapp/phone";

export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type StatusUpdate = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string;
  errorCode: number | null;
  errorTitle: string | null;
  pricingCategory: string | null;
  billable: boolean | null;
};

export type InboundMessage = { phone: string; action: "stop" | "start" | "message" };

type Payload = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        statuses?: { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string }[]; pricing?: { category?: string; billable?: boolean } }[];
        messages?: { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }[];
      };
    }[];
  }[];
};

const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "STOP ALERTS", "CANCEL"]);
const START_WORDS = new Set(["START", "SUBSCRIBE", "RESUME", "UNSTOP"]);

export function parseWebhook(payload: unknown): { statuses: StatusUpdate[]; inbound: InboundMessage[] } {
  const p = payload as Payload;
  const statuses: StatusUpdate[] = [];
  const inbound: InboundMessage[] = [];
  if (p?.object !== "whatsapp_business_account") return { statuses, inbound };

  for (const change of (p.entry ?? []).flatMap((e) => e.changes ?? [])) {
    if (change.field && change.field !== "messages") continue;
    for (const s of change.value?.statuses ?? []) {
      if (!s.id || !["sent", "delivered", "read", "failed"].includes(s.status ?? "")) continue;
      const ts = Number(s.timestamp);
      statuses.push({
        providerMessageId: s.id,
        status: s.status as StatusUpdate["status"],
        at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
        errorCode: s.errors?.[0]?.code ?? null,
        errorTitle: s.errors?.[0]?.title?.slice(0, 200) ?? null,
        pricingCategory: s.pricing?.category ?? null,
        billable: typeof s.pricing?.billable === "boolean" ? s.pricing.billable : null,
      });
    }
    for (const m of change.value?.messages ?? []) {
      const phone = m.from ? fromWaId(m.from) : null;
      if (!phone) continue;
      const text = (m.text?.body ?? m.button?.text ?? "").trim().toUpperCase().replace(/[.!]+$/, "");
      inbound.push({ phone, action: STOP_WORDS.has(text) ? "stop" : START_WORDS.has(text) ? "start" : "message" });
    }
  }
  return { statuses, inbound };
}
