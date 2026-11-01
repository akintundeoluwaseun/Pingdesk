# Background processing & scheduler

PingDesk runs entirely in the cloud. Nothing depends on the customer's computer: Gmail is read through Google's API, work is queued in Postgres, and alerts go out through Meta's API.

## How work flows
```
pg_cron (every minute) ──POST──▶ /api/cron/tick
                                   │ 1. enqueue_due_syncs()   → one sync_inbox job per due inbox
                                   │ 2. enqueue maintenance   → once per day (idempotency key)
                                   └ 3. worker: claim → run → complete / retry / dead
sync_inbox job ──▶ Gmail history ──▶ INSERT notifications
                                        └─ trigger (same transaction) → deliver_notification job
deliver_notification job ──▶ preferences ──▶ WhatsApp template ──▶ delivery_logs
Meta webhook (failed, retryable) ──▶ re-queues deliver_notification
```

## Queue guarantees (`supabase/migrations/…_job_queue.sql`)
| Property | How |
|---|---|
| Survives restarts/redeploys | Jobs are rows in Postgres |
| One worker per job | `claim_jobs` uses `FOR UPDATE SKIP LOCKED` + a lease (`locked_until`) |
| Crash recovery | Expired lease → job is claimable again (counts as an attempt) |
| No infinite loops | `max_attempts`; exhausted jobs become `dead` |
| No stale overwrites | `complete_job` / `fail_job` require the current `locked_by` |
| No duplicate work | `idempotency_key` (once ever), `dedupe_key` (one active at a time) |
| No lost notifications | delivery job created by trigger in the notification's transaction |
| Idempotent delivery | handler re-reads status and does nothing unless `received`/`queued` |
| Time limits respected | budget checked before each job; unstarted jobs are released without using an attempt |

Delivery is **at-least-once**: if the process dies after Meta accepted a message but before PingDesk recorded it, the alert can be sent twice. This is rare and preferable to losing alerts.

Finished jobs are kept 7 days (dead jobs 30 days) by the daily `maintenance` job. `select * from queue_stats();` shows queue health.

## Primary scheduler: Supabase pg_cron (free, every minute)
Run once in the Supabase SQL editor, replacing the two values:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP-DOMAIN', 'pingdesk_url');
select vault.create_secret('YOUR_INTERNAL_CRON_SECRET', 'pingdesk_cron_secret');

select cron.schedule(
  'pingdesk-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'pingdesk_url') || '/api/cron/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pingdesk_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
```
Check it's running: `select * from cron.job_run_details order by start_time desc limit 5;`
Stop it: `select cron.unschedule('pingdesk-tick');`

The secret is stored in Supabase Vault, not in the job definition.

## Backup scheduler: GitHub Actions
`.github/workflows/tick.yml` calls the same endpoint every 5 minutes once the `PINGDESK_URL` and `INTERNAL_CRON_SECRET` repository secrets are set. Free for public repositories; on private repositories it uses Actions minutes. GitHub may delay scheduled runs, so keep pg_cron as the main trigger.

Running both is safe: overlapping ticks never process the same job twice.

## Notes
- Vercel's free plan only allows daily cron jobs, which is too slow for alerts — use pg_cron instead.
- Latency: an alert normally goes out within about 1–2 minutes of the email reaching Gmail (sync interval + queue). Gmail push notifications (Pub/Sub) can cut this further later.
