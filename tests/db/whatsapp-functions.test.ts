import { beforeEach, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let user: string;
const PHONE = "+2348031234567";

const start = (u: string, phone = PHONE, hash = "h1") =>
  db.query<{ r: string }>("select public.start_whatsapp_verification($1, $2, $3, 'v1', 600) as r", [u, phone, hash]).then((x) => x.rows[0].r);
const confirm = (u: string, hash: string) =>
  db.query<{ r: string }>("select public.confirm_whatsapp_verification($1, $2) as r", [u, hash]).then((x) => x.rows[0].r);
const clearCooldown = () => db.query("update public.whatsapp_verification_sends set created_at = created_at - interval '61 seconds'");

async function verified(u: string, phone = PHONE) {
  await db.query("delete from public.whatsapp_verification_sends where user_id = $1", [u]);
  await start(u, phone, "ok-hash");
  await confirm(u, "ok-hash");
}

async function notification(u: string, opts: { category?: string; minutesAgo?: number } = {}) {
  const inbox = (
    await db.query<{ id: string }>("select public.link_gmail_inbox($1, $2, 'v1:t', 1::smallint, 's') as id", [u, `${u.slice(0, 8)}@gmail.test`])
  ).rows[0].id;
  const r = await db.query<{ id: string }>(
    `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint)
     values ($1, $2, $3, $4, 'Main', 'e.fiverr.com', now() - make_interval(mins => $5), $6) returning id`,
    [u, inbox, crypto.randomUUID(), opts.category ?? "buyer_message", opts.minutesAgo ?? 1, crypto.randomUUID()],
  );
  return r.rows[0].id;
}
const nrow = async (id: string) =>
  (await db.query<{ status: string; delivery_attempts: number; next_attempt_at: string | null; skip_reason: string | null; delivery_locked_until: string | null }>(
    "select status, delivery_attempts, next_attempt_at, skip_reason, delivery_locked_until from public.notifications where id = $1",
    [id],
  )).rows[0];

beforeEach(async () => {
  db = await createTestDb();
  user = await createUser(db, "seller@example.test");
});

describe("verification", () => {
  it("is service-role only", async () => {
    await as(db, "authenticated", user, async (tx) => {
      await expect(tx.query("select public.start_whatsapp_verification($1, $2, 'h', 'v1')", [user, PHONE])).rejects.toThrow(/permission denied/);
      await expect(tx.query("select public.confirm_whatsapp_verification($1, 'h')", [user])).rejects.toThrow(/permission denied/);
      await expect(tx.query("select * from public.whatsapp_verification_sends")).rejects.toThrow(/permission denied/);
    });
  });

  it("verifies with the right code and records opt-in", async () => {
    expect(await start(user)).toBe("ok");
    expect(await confirm(user, "wrong")).toBe("invalid");
    expect(await confirm(user, "h1")).toBe("verified");
    const r = (await db.query<{ status: string; opted_in_at: string | null; verification_code_hash: string | null; opt_in_version: string }>(
      "select status, opted_in_at, verification_code_hash, opt_in_version from public.whatsapp_connections where user_id = $1", [user])).rows[0];
    expect(r).toMatchObject({ status: "verified", verification_code_hash: null, opt_in_version: "v1" });
    expect(r.opted_in_at).not.toBeNull();
    expect(await start(user)).toBe("already_verified");
  });

  it("locks after five wrong codes and rejects expired codes", async () => {
    await start(user);
    for (let i = 0; i < 4; i++) expect(await confirm(user, "bad")).toBe("invalid");
    expect(await confirm(user, "bad")).toBe("locked");
    expect(await confirm(user, "h1")).toBe("locked");
    await clearCooldown();
    await start(user, PHONE, "h2");
    await db.query("update public.whatsapp_connections set verification_expires_at = now() - interval '1 second'");
    expect(await confirm(user, "h2")).toBe("expired");
  });

  it("enforces cooldown, per-account and per-phone limits", async () => {
    expect(await start(user)).toBe("ok");
    expect(await start(user)).toBe("cooldown");
    for (let i = 0; i < 4; i++) {
      await clearCooldown();
      expect(await start(user)).toBe("ok");
    }
    await clearCooldown();
    expect(await start(user)).toBe("user_limit");
    // A different account can't keep hammering the same number either.
    const other = await createUser(db, "other@example.test");
    expect(await start(other)).toBe("phone_limit");
    expect(await start(other, "+2348039999999")).toBe("ok");
  });

  it("rejects malformed numbers", async () => {
    expect(await start(user, "08031234567")).toBe("invalid_phone");
  });
});

describe("inbound STOP / START", () => {
  it("opts out and back in, and tracks the 24-hour window", async () => {
    await verified(user);
    await db.query("select public.whatsapp_inbound($1, 'stop')", [PHONE]);
    let r = (await db.query<{ status: string; last_inbound_at: string | null }>("select status, last_inbound_at from public.whatsapp_connections")).rows[0];
    expect(r.status).toBe("opted_out");
    expect(r.last_inbound_at).not.toBeNull();
    await db.query("select public.whatsapp_inbound($1, 'start')", [PHONE]);
    r = (await db.query<{ status: string; last_inbound_at: string | null }>("select status, last_inbound_at from public.whatsapp_connections")).rows[0];
    expect(r.status).toBe("verified");
  });

  it("START never verifies a number that was never verified", async () => {
    await start(user);
    await db.query("select public.whatsapp_inbound($1, 'start')", [PHONE]);
    expect((await db.query<{ status: string }>("select status from public.whatsapp_connections")).rows[0].status).toBe("pending_verification");
  });
});

describe("delivery claiming and recording", () => {
  it("builds delivery context with preferences, phone and hourly count", async () => {
    await verified(user);
    await db.query("update public.notification_preferences set buyer_message = false where user_id = $1", [user]);
    const id = await notification(user);
    const c = await db.query<Record<string, unknown>>("select * from public.delivery_context($1)", [id]);
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({ id, status: "received", category: "buyer_message", category_enabled: false, alerts_paused: false, phone_e164: PHONE, whatsapp_status: "verified", sent_last_hour: 0, timezone: "UTC" });
  });

  it("records skip, submit, retry and permanent failure", async () => {
    const a = await notification(user);
    await db.query("select public.record_delivery_attempt($1, 'skipped', p_skip_reason => 'preference_off')", [a]);
    expect(await nrow(a)).toMatchObject({ status: "skipped", skip_reason: "preference_off", delivery_attempts: 0 });

    const b = await notification(user, { category: "payment" });
    await db.query("select public.record_delivery_attempt($1, 'retry', p_error_code => '131000', p_retry_at => now() + interval '2 minutes')", [b]);
    expect(await nrow(b)).toMatchObject({ status: "queued", delivery_attempts: 1 });
    await db.query("select public.record_delivery_attempt($1, 'submitted', p_provider_message_id => 'wamid.B2', p_recipient_last4 => '4567')", [b]);
    expect(await nrow(b)).toMatchObject({ status: "delivering", delivery_attempts: 2, next_attempt_at: null, delivery_locked_until: null });
    const logs = await db.query<{ attempt: number; status: string }>("select attempt, status from public.delivery_logs where notification_id = $1 order by attempt", [b]);
    expect(logs.rows).toEqual([{ attempt: 1, status: "failed" }, { attempt: 2, status: "submitted" }]);

    const c = await notification(user, { category: "policy" });
    await db.query("select public.record_delivery_attempt($1, 'failed', p_error_code => '131026')", [c]);
    expect(await nrow(c)).toMatchObject({ status: "failed", delivery_attempts: 1 });
  });

  it("defers without using an attempt", async () => {
    const a = await notification(user);
    await db.query("select public.record_delivery_attempt($1, 'deferred', p_retry_at => now() + interval '15 minutes')", [a]);
    expect(await nrow(a)).toMatchObject({ status: "queued", delivery_attempts: 0 });
  });
});

describe("apply_delivery_status (webhook)", () => {
  async function submitted(provider: string) {
    const id = await notification(user);
    await db.query("select public.record_delivery_attempt($1, 'submitted', p_provider_message_id => $2)", [id, provider]);
    return id;
  }
  const apply = (p: string, s: string, retry: string | null = null, code: string | null = null) =>
    db.query<{ r: boolean }>("select public.apply_delivery_status($1, $2, now(), $4, null, 'utility', true, $3::timestamptz) as r", [p, s, retry, code]).then((x) => x.rows[0].r);

  it("moves forward only and marks the notification delivered", async () => {
    const id = await submitted("wamid.1");
    expect(await apply("wamid.1", "sent")).toBe(true);
    expect(await apply("wamid.1", "read")).toBe(true);
    expect(await apply("wamid.1", "delivered")).toBe(false); // late, out-of-order
    expect(await apply("wamid.1", "failed")).toBe(false); // can't fail after read
    const d = (await db.query<{ status: string; delivered_at: string | null; read_at: string | null; pricing_category: string; billable: boolean }>(
      "select status, delivered_at, read_at, pricing_category, billable from public.delivery_logs where provider_message_id = 'wamid.1'")).rows[0];
    expect(d).toMatchObject({ status: "read", pricing_category: "utility", billable: true });
    expect(d.delivered_at).not.toBeNull();
    expect((await nrow(id)).status).toBe("delivered");
    expect(await apply("wamid.unknown", "sent")).toBe(false);
  });

  it("failed after acceptance schedules a retry when asked, else fails", async () => {
    const a = await submitted("wamid.2");
    await apply("wamid.2", "failed", new Date(Date.now() + 60_000).toISOString(), "131000");
    expect(await nrow(a)).toMatchObject({ status: "queued" });
    const b = await submitted("wamid.3");
    await apply("wamid.3", "failed", null, "131026");
    expect(await nrow(b)).toMatchObject({ status: "failed" });
    expect((await db.query<{ error_code: string }>("select error_code from public.delivery_logs where provider_message_id = 'wamid.3'")).rows[0].error_code).toBe("131026");
  });

  it("a stale status for an older attempt doesn't override the newer attempt", async () => {
    const id = await notification(user);
    await db.query("select public.record_delivery_attempt($1, 'submitted', p_provider_message_id => 'old')", [id]);
    await apply("old", "failed", new Date().toISOString());
    await db.query("select public.record_delivery_attempt($1, 'submitted', p_provider_message_id => 'new')", [id]);
    await apply("new", "delivered");
    await apply("old", "sent"); // ignored: failed log can't move to sent? (rank) and not latest anyway
    expect((await nrow(id)).status).toBe("delivered");
  });
});
