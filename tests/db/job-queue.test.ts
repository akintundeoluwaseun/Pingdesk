import { beforeEach, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let user: string;

type JobRow = { id: string; job_type: string; status: string; attempts: number; locked_by: string | null; last_error: string | null; run_at: string };

const enqueue = (type: string, opts: { idem?: string; dedupe?: string; runAt?: string; max?: number; priority?: number } = {}) =>
  db
    .query<{ id: string }>("select public.enqueue_job($1, '{}'::jsonb, null, coalesce($2::timestamptz, now()), $3, $4, $5::smallint, $6::smallint) as id", [
      type,
      opts.runAt ?? null,
      opts.idem ?? null,
      opts.dedupe ?? null,
      opts.max ?? 8,
      opts.priority ?? 100,
    ])
    .then((r) => r.rows[0].id);
const claim = (worker: string, limit = 10, lease = 120) =>
  db.query<JobRow>("select * from public.claim_jobs($1, null, $2, $3)", [worker, limit, lease]).then((r) => r.rows);
const complete = (id: string, worker: string) => db.query<{ ok: boolean }>("select public.complete_job($1, $2) as ok", [id, worker]).then((r) => r.rows[0].ok);
const fail = (id: string, worker: string, opts: { retryAt?: string; permanent?: boolean } = {}) =>
  db
    .query<{ r: string }>("select public.fail_job($1, $2, 'boom', $3::timestamptz, $4) as r", [id, worker, opts.retryAt ?? null, opts.permanent ?? false])
    .then((r) => r.rows[0].r);
const job = (id: string) => db.query<JobRow>("select * from public.jobs where id = $1", [id]).then((r) => r.rows[0]);
const expireLeases = () => db.query("update public.jobs set locked_until = now() - interval '1 second' where status = 'running'");

beforeEach(async () => {
  db = await createTestDb();
  user = await createUser(db, "seller@example.test");
});

describe("access", () => {
  it("queue functions and the jobs table are service-role only", async () => {
    await as(db, "authenticated", user, async (tx) => {
      await expect(tx.query("select public.enqueue_job('x')")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select * from public.claim_jobs('w')")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select * from public.queue_stats()")).rejects.toThrow(/permission denied/);
    });
  });
});

describe("enqueue", () => {
  it("idempotency key: enqueued at most once, ever", async () => {
    const a = await enqueue("maintenance", { idem: "maintenance:2026-11-01" });
    const w = (await claim("w1"))[0];
    await complete(w.id, "w1");
    const b = await enqueue("maintenance", { idem: "maintenance:2026-11-01" });
    expect(b).toBe(a);
    expect((await db.query("select 1 from public.jobs")).rows).toHaveLength(1);
  });

  it("dedupe key: one active job at a time, a new one allowed after it finishes", async () => {
    const a = await enqueue("sync_inbox", { dedupe: "sync:1" });
    expect(await enqueue("sync_inbox", { dedupe: "sync:1" })).toBe(a);
    const w = (await claim("w1"))[0];
    expect(await enqueue("sync_inbox", { dedupe: "sync:1" })).toBe(a); // still running
    await complete(w.id, "w1");
    const b = await enqueue("sync_inbox", { dedupe: "sync:1" });
    expect(b).not.toBe(a);
  });

  it("a duplicate with an earlier time pulls the queued job forward", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const a = await enqueue("x", { dedupe: "k", runAt: future });
    await enqueue("x", { dedupe: "k" });
    expect(new Date((await job(a)).run_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("claim", () => {
  it("never hands the same job to two workers (SKIP LOCKED + lease)", async () => {
    await enqueue("x");
    await enqueue("x");
    const a = await claim("w1", 1);
    const b = await claim("w2", 5);
    const c = await claim("w3", 5);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(b[0].id).not.toBe(a[0].id);
    expect(c).toHaveLength(0);
  });

  it("respects run_at and priority", async () => {
    await enqueue("later", { runAt: new Date(Date.now() + 60_000).toISOString() });
    await enqueue("low", { priority: 200 });
    await enqueue("high", { priority: 10 });
    expect((await claim("w", 10)).map((j) => j.job_type)).toEqual(["high", "low"]);
  });
});

describe("restart recovery", () => {
  it("a crashed worker's job is picked up by the next worker; the late worker can't overwrite it", async () => {
    const id = await enqueue("deliver_notification");
    const first = (await claim("crashed-worker"))[0];
    expect(first).toMatchObject({ id, attempts: 1, locked_by: "crashed-worker" });

    expect(await claim("w2")).toHaveLength(0); // lease still held
    await expireLeases(); // process died; lease runs out
    const second = (await claim("w2"))[0];
    expect(second).toMatchObject({ id, attempts: 2, locked_by: "w2" });

    expect(await complete(id, "crashed-worker")).toBe(false); // fenced
    expect(await fail(id, "crashed-worker")).toBe("lost_lease");
    expect(await complete(id, "w2")).toBe(true);
    expect((await job(id)).status).toBe("succeeded");
  });

  it("a job that keeps crashing ends up dead instead of looping forever", async () => {
    const id = await enqueue("poison", { max: 2 });
    await claim("w1");
    await expireLeases();
    await claim("w2");
    await expireLeases();
    expect(await claim("w3")).toHaveLength(0);
    expect(await job(id)).toMatchObject({ status: "dead", last_error: "lease expired after final attempt" });
  });
});

describe("release", () => {
  it("returns an unstarted job without using an attempt", async () => {
    const id = await enqueue("x");
    await claim("w");
    expect((await db.query<{ ok: boolean }>("select public.release_job($1, 'w') as ok", [id])).rows[0].ok).toBe(true);
    expect(await job(id)).toMatchObject({ status: "queued", attempts: 0, locked_by: null });
    expect((await db.query<{ ok: boolean }>("select public.release_job($1, 'w') as ok", [id])).rows[0].ok).toBe(false);
  });
});

describe("fail", () => {
  it("retries with backoff, honours an explicit time, and parks after max attempts", async () => {
    const id = await enqueue("x", { max: 3 });
    await claim("w");
    expect(await fail(id, "w")).toBe("retry");
    let j = await job(id);
    expect(j.status).toBe("queued");
    expect(new Date(j.run_at).getTime()).toBeGreaterThan(Date.now() + 20_000); // ~30 s backoff
    expect(j.last_error).toBe("boom");

    await db.query("update public.jobs set run_at = now() where id = $1", [id]);
    await claim("w");
    const at = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(await fail(id, "w", { retryAt: at })).toBe("retry");
    j = await job(id);
    expect(new Date(j.run_at).toISOString()).toBe(at);

    await db.query("update public.jobs set run_at = now() where id = $1", [id]);
    await claim("w");
    expect(await fail(id, "w")).toBe("dead");
  });

  it("permanent failures are parked immediately", async () => {
    const id = await enqueue("x");
    await claim("w");
    expect(await fail(id, "w", { permanent: true })).toBe("dead");
  });
});

describe("notification → delivery job", () => {
  async function notification() {
    const inbox = (await db.query<{ id: string }>("select public.link_gmail_inbox($1, 'a@gmail.test', 'v1:t', 1::smallint, 's') as id", [user])).rows[0].id;
    const r = await db.query<{ id: string }>(
      `insert into public.notifications (user_id, inbox_id, gmail_message_id, category, inbox_label, sender_domain, received_at, fingerprint)
       values ($1, $2, $3, 'new_order', 'Main', 'e.fiverr.com', now(), $4) returning id`,
      [user, inbox, crypto.randomUUID(), crypto.randomUUID()],
    );
    return r.rows[0].id;
  }

  it("is created in the same transaction as the notification", async () => {
    const id = await notification();
    const jobs = await db.query<{ job_type: string; payload: { notification_id: string }; priority: number }>(
      "select job_type, payload, priority from public.jobs",
    );
    expect(jobs.rows).toEqual([{ job_type: "deliver_notification", payload: { notification_id: id }, priority: 10 }]);
  });

  it("a rolled-back notification leaves no job behind", async () => {
    await db.exec("begin");
    await notification();
    await db.exec("rollback");
    expect((await db.query("select 1 from public.jobs")).rows).toHaveLength(0);
  });

  it("a retryable failure reported by webhook re-queues delivery", async () => {
    const id = await notification();
    const w = (await claim("w"))[0];
    await db.query("select public.record_delivery_attempt($1, 'submitted', p_provider_message_id => 'wamid.9')", [id]);
    await complete(w.id, "w");
    const at = new Date(Date.now() + 120_000).toISOString();
    await db.query("select public.apply_delivery_status('wamid.9', 'failed', now(), '131000', 'x', null, null, $1::timestamptz)", [at]);
    const q = await db.query<{ status: string; run_at: string }>("select status, run_at from public.jobs where status = 'queued'");
    expect(q.rows).toHaveLength(1);
    expect(new Date(q.rows[0].run_at).toISOString()).toBe(at);
  });
});

describe("housekeeping", () => {
  it("removes old finished jobs and reports queue stats", async () => {
    const a = await enqueue("x");
    await claim("w");
    await complete(a, "w");
    await db.query("update public.jobs set finished_at = now() - interval '8 days'");
    await enqueue("y");
    expect((await db.query<{ n: number }>("select public.cleanup_jobs() as n")).rows[0].n).toBe(1);
    const stats = await db.query<{ job_type: string; status: string; jobs: number }>("select job_type, status, jobs::int as jobs from public.queue_stats()");
    expect(stats.rows).toEqual([{ job_type: "y", status: "queued", jobs: 1 }]);
  });
});
