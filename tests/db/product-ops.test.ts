import { beforeEach, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let alice: string;
let bob: string;

const inbox = async (u: string, email: string) =>
  (await db.query<{ id: string }>("select public.link_gmail_inbox($1, $2, 'v1:t', 1::smallint, 's') as id", [u, email])).rows[0].id;

async function notification(u: string, inboxId: string, daysAgo: number, status: string) {
  await db.query(
    `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint, status)
     values ($1, $2, $3, 'payment', 'Main', 'e.fiverr.com', now() - make_interval(days => $4), $5, $6)`,
    [u, inboxId, crypto.randomUUID(), daysAgo, crypto.randomUUID(), status],
  );
}

beforeEach(async () => {
  db = await createTestDb();
  alice = await createUser(db, "alice@example.test");
  bob = await createUser(db, "bob@example.test");
});

describe("activity log", () => {
  it("users read only their own events and can't write any", async () => {
    await db.query("insert into public.audit_events (user_id, event, details) values ($1, 'inbox.connected', '{}'), ($2, 'whatsapp.verified', '{}')", [alice, bob]);
    await as(db, "authenticated", alice, async (tx) => {
      const r = await tx.query<{ event: string }>("select event from public.audit_events");
      expect(r.rows).toEqual([{ event: "inbox.connected" }]);
      await expect(tx.query("insert into public.audit_events (user_id, event) values ($1, 'x.y')", [alice])).rejects.toThrow(/permission denied/);
      await expect(tx.query("delete from public.audit_events")).rejects.toThrow(/permission denied/);
    });
  });

  it("rejects malformed event names", async () => {
    await expect(db.query("insert into public.audit_events (user_id, event) values ($1, 'DROP TABLE')", [alice])).rejects.toThrow(/check constraint/);
  });
});

describe("retention", () => {
  it("users can change only their own retention, to allowed values", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await tx.query("update public.profiles set retention_days = 30 where id = $1", [alice]);
      await expect(tx.query("update public.profiles set retention_days = 7 where id = $1", [alice])).rejects.toThrow(/check constraint/);
    });
    const r = await db.query<{ id: string; retention_days: number }>("select id, retention_days from public.profiles order by retention_days");
    expect(r.rows.find((x) => x.id === alice)?.retention_days).toBe(30);
    expect(r.rows.find((x) => x.id === bob)?.retention_days).toBe(90);
  });

  it("deletes finished alerts past each user's retention, keeps pending ones", async () => {
    await db.query("update public.profiles set retention_days = 30 where id = $1", [alice]);
    const a = await inbox(alice, "a@gmail.test");
    const b = await inbox(bob, "b@gmail.test");
    await notification(alice, a, 45, "delivered"); // deleted (alice keeps 30d)
    await notification(alice, a, 45, "queued"); // kept: still pending
    await notification(alice, a, 10, "delivered"); // kept
    await notification(bob, b, 45, "delivered"); // kept (bob keeps 90d)
    await notification(bob, b, 100, "skipped"); // deleted
    await db.query("insert into public.audit_events (user_id, event, created_at) values ($1, 'inbox.connected', now() - interval '400 days')", [alice]);

    const res = (await db.query<{ r: Record<string, number> }>("select public.run_retention() as r")).rows[0].r;
    expect(res).toMatchObject({ notifications: 2, audit_events: 1 });
    const left = await db.query<{ user_id: string; status: string }>("select user_id, status from public.notifications order by user_id, status");
    expect(left.rows).toHaveLength(3);
  });

  it("is service-role only", async () => {
    await as(db, "authenticated", alice, async (tx) => {
      await expect(tx.query("select public.run_retention()")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select public.ops_status()")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select public.rate_limit_hit('k', 1, 60)")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select public.request_sync_now($1, gen_random_uuid())", [alice])).rejects.toThrow(/permission denied/);
    });
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window, per key", async () => {
    const hit = (k: string) => db.query<{ ok: boolean }>("select public.rate_limit_hit($1, 3, 3600) as ok", [k]).then((r) => r.rows[0].ok);
    expect([await hit("a"), await hit("a"), await hit("a"), await hit("a")]).toEqual([true, true, true, false]);
    expect(await hit("b")).toBe(true);
  });
});

describe("check now", () => {
  it("queues a sync for the owner's inbox only, with a limit", async () => {
    const a = await inbox(alice, "a@gmail.test");
    const req = (u: string, i: string) => db.query<{ r: string }>("select public.request_sync_now($1, $2) as r", [u, i]).then((r) => r.rows[0].r);
    expect(await req(bob, a)).toBe("not_found");
    expect(await req(alice, a)).toBe("queued");
    const jobs = await db.query<{ n: number }>("select count(*)::int as n from public.jobs where job_type = 'sync_inbox'");
    expect(jobs.rows[0].n).toBe(1); // repeated requests reuse the active job
    for (let i = 0; i < 5; i++) await req(alice, a);
    expect(await req(alice, a)).toBe("rate_limited");
    await db.query("select public.disconnect_inbox($1, $2)", [alice, a]);
    expect(await req(alice, a)).toBe("not_found");
  });
});

describe("ops status", () => {
  it("reports aggregate counts without personal data", async () => {
    const a = await inbox(alice, "a@gmail.test");
    await notification(alice, a, 0, "delivered");
    const s = (await db.query<{ s: Record<string, unknown> }>("select public.ops_status() as s")).rows[0].s;
    expect(s).toMatchObject({ users: 2, inboxes: { active: 1 }, notifications_24h: { delivered: 1 } });
    expect(JSON.stringify(s)).not.toContain("gmail.test");
    expect(s.queue).toMatchObject({ queued: 1, running: 0, dead_24h: 0 });
  });
});
