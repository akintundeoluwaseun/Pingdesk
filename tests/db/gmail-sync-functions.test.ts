import { beforeEach, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let user: string;

async function inbox(email: string) {
  const r = await db.query<{ id: string }>(
    "select public.link_gmail_inbox($1, $2, 'v1:tok', 1::smallint, 'gmail.readonly') as id",
    [user, email],
  );
  return r.rows[0].id;
}
const claim = (limit = 10) =>
  db.query<{ id: string; encrypted_refresh_token: string }>("select * from public.claim_inboxes_for_sync($1, 120, 60)", [limit]);
const row = async (id: string) =>
  (
    await db.query<{ status: string; last_history_id: string | null; consecutive_failures: number; last_error_code: string | null; sync_locked_until: string | null; last_reconciled_at: string | null }>(
      "select status, last_history_id, consecutive_failures, last_error_code, sync_locked_until, last_reconciled_at from public.connected_inboxes where id = $1",
      [id],
    )
  ).rows[0];

beforeEach(async () => {
  db = await createTestDb();
  user = await createUser(db, "seller@example.test");
});

describe("claim_inboxes_for_sync", () => {
  it("is service-role only", async () => {
    await as(db, "authenticated", user, async (tx) => {
      await expect(tx.query("select * from public.claim_inboxes_for_sync()")).rejects.toThrow(/permission denied/);
      await expect(tx.query("select public.finish_inbox_sync(gen_random_uuid(), null, false)")).rejects.toThrow(/permission denied/);
    });
  });

  it("leases inboxes so a second worker gets nothing", async () => {
    const a = await inbox("a@gmail.test");
    const first = await claim();
    expect(first.rows.map((r) => r.id)).toEqual([a]);
    expect(first.rows[0].encrypted_refresh_token).toBe("v1:tok");
    expect((await claim()).rows).toHaveLength(0);
  });

  it("re-offers an inbox when the lease expires (crashed worker)", async () => {
    const a = await inbox("a@gmail.test");
    await claim();
    await db.query("update public.connected_inboxes set sync_locked_until = now() - interval '1 second' where id = $1", [a]);
    expect((await claim()).rows.map((r) => r.id)).toEqual([a]);
  });

  it("skips disconnected, reauth-needed and recently synced inboxes", async () => {
    const a = await inbox("a@gmail.test");
    const b = await inbox("b@gmail.test");
    const c = await inbox("c@gmail.test");
    await db.query("select public.disconnect_inbox($1, $2)", [user, a]);
    await db.query("update public.connected_inboxes set status = 'needs_reauth' where id = $1", [b]);
    await db.query("update public.connected_inboxes set last_synced_at = now() where id = $1", [c]);
    expect((await claim()).rows).toHaveLength(0);
  });

  it("backs off inboxes that keep failing", async () => {
    const a = await inbox("a@gmail.test");
    await db.query("update public.connected_inboxes set consecutive_failures = 3, last_error_at = now() - interval '5 minutes' where id = $1", [a]);
    expect((await claim()).rows).toHaveLength(0); // 8-minute backoff
    await db.query("update public.connected_inboxes set last_error_at = now() - interval '9 minutes' where id = $1", [a]);
    expect((await claim()).rows).toHaveLength(1);
  });
});

describe("finish_inbox_sync", () => {
  it("saves the cursor and clears errors on success", async () => {
    const a = await inbox("a@gmail.test");
    await db.query("update public.connected_inboxes set consecutive_failures = 2, last_error_code = 'unavailable', status = 'error' where id = $1", [a]);
    await claim();
    await db.query("select public.finish_inbox_sync($1, '777', true)", [a]);
    expect(await row(a)).toMatchObject({ status: "active", last_history_id: "777", consecutive_failures: 0, last_error_code: null, sync_locked_until: null });
    expect((await row(a)).last_reconciled_at).not.toBeNull();
  });

  it("marks the inbox for reconnection on revoked access", async () => {
    const a = await inbox("a@gmail.test");
    await db.query("select public.finish_inbox_sync($1, null, false, 'auth_revoked', true)", [a]);
    expect(await row(a)).toMatchObject({ status: "needs_reauth", last_error_code: "auth_revoked" });
  });

  it("counts transient failures and flags the inbox after five in a row", async () => {
    const a = await inbox("a@gmail.test");
    for (let i = 0; i < 4; i++) await db.query("select public.finish_inbox_sync($1, null, false, 'unavailable')", [a]);
    expect(await row(a)).toMatchObject({ status: "active", consecutive_failures: 4 });
    await db.query("select public.finish_inbox_sync($1, null, false, 'unavailable')", [a]);
    expect(await row(a)).toMatchObject({ status: "error", consecutive_failures: 5 });
  });

  it("never revives a disconnected inbox", async () => {
    const a = await inbox("a@gmail.test");
    await db.query("select public.disconnect_inbox($1, $2)", [user, a]);
    await db.query("select public.finish_inbox_sync($1, '1', true)", [a]);
    expect((await row(a)).status).toBe("disconnected");
  });

  it("reconnecting a needs_reauth inbox makes it claimable again", async () => {
    const a = await inbox("a@gmail.test");
    await db.query("select public.finish_inbox_sync($1, null, false, 'auth_revoked', true)", [a]);
    expect((await claim()).rows).toHaveLength(0);
    await inbox("a@gmail.test");
    expect((await claim()).rows.map((r) => r.id)).toEqual([a]);
  });
});
