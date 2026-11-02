import { describe, expect, it, vi } from "vitest";
import { runWorker } from "@/server/jobs/worker";
import { deliverNotificationHandler, syncInboxHandler, type DeliveryContext } from "@/server/jobs/handlers";
import { PermanentJobError, type Job, type Queue } from "@/server/jobs/types";
import { MetaError, type WhatsAppClient } from "@/lib/whatsapp/meta";
import { GmailError, type GmailPort } from "@/server/gmail/types";

class FakeQueue implements Queue {
  jobs: (Job & { status: string; error?: string; retryAt?: Date | null })[] = [];
  add(job_type: string, payload: Record<string, unknown> = {}) {
    this.jobs.push({ id: `j${this.jobs.length + 1}`, job_type, payload, user_id: null, attempts: 0, max_attempts: 3, status: "queued" });
  }
  async claim(_w: string, limit: number) {
    const ready = this.jobs.filter((j) => j.status === "queued").slice(0, limit);
    ready.forEach((j) => {
      j.status = "running";
      j.attempts++;
    });
    return ready.map((j) => ({ ...j }));
  }
  async complete(id: string) {
    this.find(id).status = "succeeded";
    return true;
  }
  async release(id: string) {
    const j = this.find(id);
    j.status = "queued";
    j.attempts--;
    return true;
  }
  async fail(id: string, _w: string, error: string, opts?: { retryAt?: Date | null; permanent?: boolean }) {
    const j = this.find(id);
    j.error = error;
    j.retryAt = opts?.retryAt ?? null;
    j.status = opts?.permanent || j.attempts >= j.max_attempts ? "dead" : "retry-later";
    return j.status === "dead" ? ("dead" as const) : ("retry" as const);
  }
  find(id: string) {
    return this.jobs.find((j) => j.id === id)!;
  }
}

describe("worker loop", () => {
  it("routes jobs to handlers and records outcomes", async () => {
    const q = new FakeQueue();
    q.add("ok");
    q.add("later");
    q.add("broken");
    q.add("unknown");
    q.add("fatal");
    const at = new Date(Date.now() + 60_000);
    const s = await runWorker(
      q,
      {
        ok: async () => ({ kind: "done" }),
        later: async () => ({ kind: "retry", at, reason: "wait" }),
        broken: async () => {
          throw new Error("network down");
        },
        fatal: async () => {
          throw new PermanentJobError("bad payload");
        },
      },
      { workerId: "w", budgetMs: 10_000 },
    );
    expect(s).toMatchObject({ claimed: 5, done: 1, retried: 2, dead: 2 });
    expect(q.find("j2").retryAt).toEqual(at);
    expect(q.find("j3").error).toBe("network down");
    expect(q.find("j4")).toMatchObject({ status: "dead", error: 'no handler for job type "unknown"' });
    expect(q.find("j5").status).toBe("dead");
  });

  it("stops when the time budget is spent", async () => {
    const q = new FakeQueue();
    for (let i = 0; i < 30; i++) q.add("slow");
    let t = 0;
    const s = await runWorker(q, { slow: async () => ({ kind: "done" }) }, { workerId: "w", budgetMs: 100, batchSize: 10, now: () => (t += 40) });
    // t: 40 (loop) -> claim 10 -> jobs at 80, then 120 >= budget: remaining 9 released
    expect(s).toMatchObject({ claimed: 10, done: 1, released: 9 });
    expect(q.jobs.filter((j) => j.status === "queued")).toHaveLength(29);
    expect(q.jobs.every((j) => j.status !== "queued" || j.attempts === 0)).toBe(true);
  });
});

const ctx = (over: Partial<DeliveryContext> = {}): DeliveryContext => ({
  id: "n1",
  user_id: "u1",
  status: "received",
  category: "new_order",
  inbox_label: "Main",
  received_at: new Date().toISOString(),
  delivery_attempts: 0,
  timezone: "UTC",
  alerts_paused: false,
  category_enabled: true,
  phone_e164: "+2348031234567",
  whatsapp_status: "verified",
  sent_last_hour: 0,
  ...over,
});
const job = (payload: Record<string, unknown>): Job => ({ id: "j", job_type: "deliver_notification", payload, user_id: null, attempts: 1, max_attempts: 20 });

function deliveryDeps(c: DeliveryContext | null, send?: WhatsAppClient["sendTemplate"]) {
  const record = vi.fn(async () => {});
  const client = { sendTemplate: send ?? vi.fn(async () => ({ messageId: "wamid.1" })), sendText: vi.fn() } as unknown as WhatsAppClient;
  return { record, client, deps: { context: async () => c, record, whatsapp: () => ({ client, template: "pingdesk_alert", language: "en" }) } };
}

describe("deliver_notification handler", () => {
  it("sends and records the provider id", async () => {
    const { deps, record } = deliveryDeps(ctx());
    expect(await deliverNotificationHandler(deps)(job({ notification_id: "n1" }))).toEqual({ kind: "done" });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ p_outcome: "submitted", p_provider_message_id: "wamid.1", p_recipient_last4: "4567" }));
  });

  it("is idempotent: already-handled or deleted notifications are not sent again", async () => {
    for (const c of [ctx({ status: "delivering" }), ctx({ status: "delivered" }), ctx({ status: "skipped" }), null]) {
      const { deps, record, client } = deliveryDeps(c);
      expect(await deliverNotificationHandler(deps)(job({ notification_id: "n1" }))).toEqual({ kind: "done" });
      expect(record).not.toHaveBeenCalled();
      expect(client.sendTemplate).not.toHaveBeenCalled();
    }
  });

  it("records skips, retries temporary errors, finishes on permanent ones", async () => {
    let t = deliveryDeps(ctx({ category_enabled: false }));
    await deliverNotificationHandler(t.deps)(job({ notification_id: "n1" }));
    expect(t.record).toHaveBeenCalledWith(expect.objectContaining({ p_outcome: "skipped", p_skip_reason: "preference_off" }));

    t = deliveryDeps(ctx(), vi.fn(async () => {
      throw new MetaError(131000, "temporary", true, false, 500);
    }));
    const r = await deliverNotificationHandler(t.deps)(job({ notification_id: "n1" }));
    expect(r.kind).toBe("retry");
    expect(t.record).toHaveBeenCalledWith(expect.objectContaining({ p_outcome: "retry", p_error_code: "131000" }));

    t = deliveryDeps(ctx(), vi.fn(async () => {
      throw new MetaError(131026, "undeliverable", false, false, 400);
    }));
    expect(await deliverNotificationHandler(t.deps)(job({ notification_id: "n1" }))).toEqual({ kind: "done" });
    expect(t.record).toHaveBeenCalledWith(expect.objectContaining({ p_outcome: "failed" }));
  });

  it("keeps alerts queued while WhatsApp isn't configured", async () => {
    const { deps, record } = deliveryDeps(ctx());
    const r = await deliverNotificationHandler({ ...deps, whatsapp: () => null })(job({ notification_id: "n1" }));
    expect(r).toMatchObject({ kind: "retry", reason: "whatsapp not configured" });
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads permanently", async () => {
    const { deps } = deliveryDeps(ctx());
    await expect(deliverNotificationHandler(deps)(job({}))).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe("sync_inbox handler", () => {
  const inbox = { id: "i1", user_id: "u1", label: "Main", status: "active", last_history_id: null, last_reconciled_at: null, refreshToken: "rt" };
  const gmail = (fail?: GmailError): GmailPort => ({
    getProfileHistoryId: async () => {
      if (fail) throw fail;
      return "500";
    },
    listHistory: async () => ({ records: [], historyId: "500" }),
    listMessages: async () => ({ ids: [] }),
    getMessageHeaders: async () => null,
  });

  it("records success, and marks revoked access for reconnection", async () => {
    const finish = vi.fn(async () => {});
    const base = { loadInbox: async () => inbox, store: { insertNotification: async () => true }, finish };
    expect(await syncInboxHandler({ ...base, gmail: () => gmail() })({ ...job({ inbox_id: "i1" }), job_type: "sync_inbox" })).toEqual({ kind: "done" });
    expect(finish).toHaveBeenLastCalledWith("i1", "500", true, null, false);

    await syncInboxHandler({ ...base, gmail: () => gmail(new GmailError("auth_revoked")) })(job({ inbox_id: "i1" }));
    expect(finish).toHaveBeenLastCalledWith("i1", null, false, "auth_revoked", true);

    await syncInboxHandler({ ...base, gmail: () => gmail(new GmailError("unavailable")) })(job({ inbox_id: "i1" }));
    expect(finish).toHaveBeenLastCalledWith("i1", null, false, "unavailable", false);
  });

  it("skips inboxes that were disconnected after the job was queued", async () => {
    const finish = vi.fn();
    await syncInboxHandler({ loadInbox: async () => ({ ...inbox, status: "disconnected" }), gmail: () => gmail(), store: { insertNotification: async () => true }, finish })(
      job({ inbox_id: "i1" }),
    );
    expect(finish).not.toHaveBeenCalled();
  });
});

import { maintenanceHandler, testAlertHandler } from "@/server/jobs/handlers";
import { describeDeliveryError, ACTIVITY_LABELS } from "@/lib/messages";

describe("send_test_alert handler", () => {
  const userJob = { ...job({}), job_type: "send_test_alert", user_id: "u1" };
  it("sends a clearly labelled test to a verified number and logs it", async () => {
    const { client } = deliveryDeps(ctx());
    const audit = vi.fn(async () => {});
    const r = await testAlertHandler({
      destination: async () => ({ phone_e164: "+2348031234567", status: "verified", timezone: "UTC" }),
      whatsapp: () => ({ client, template: "pingdesk_alert", language: "en" }),
      audit,
    })(userJob);
    expect(r).toEqual({ kind: "done" });
    const params = (client.sendTemplate as ReturnType<typeof vi.fn>).mock.calls[0][3][0].parameters.map((p: { text: string }) => p.text);
    expect(params.slice(0, 2)).toEqual(["Fiverr update", "PingDesk test"]);
    expect(audit).toHaveBeenCalledWith("u1");
  });
  it("does nothing for unverified numbers", async () => {
    const { client } = deliveryDeps(ctx());
    await testAlertHandler({ destination: async () => ({ phone_e164: "+1", status: "opted_out", timezone: "UTC" }), whatsapp: () => ({ client, template: "t", language: "en" }), audit: vi.fn() })(userJob);
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
});

describe("maintenance handler", () => {
  it("runs retention", async () => {
    const runRetention = vi.fn(async () => ({ notifications: 3 }));
    expect(await maintenanceHandler({ runRetention })({ ...job({}), job_type: "maintenance" })).toEqual({ kind: "done" });
    expect(runRetention).toHaveBeenCalled();
  });
});

describe("user-facing messages", () => {
  it("explains delivery errors and activity events in plain language", () => {
    expect(describeDeliveryError("131026", "Message undeliverable")).toMatch(/couldn't deliver/);
    expect(describeDeliveryError("http_0", null)).toMatch(/couldn't reach WhatsApp/);
    expect(describeDeliveryError(null, null)).toBe("an unknown error");
    expect(ACTIVITY_LABELS["inbox.connected"]({ email: "a@gmail.test" })).toBe("Connected Gmail inbox a@gmail.test");
    expect(ACTIVITY_LABELS["preferences.updated"]({ paused: true })).toBe("Paused all alerts");
  });
});
