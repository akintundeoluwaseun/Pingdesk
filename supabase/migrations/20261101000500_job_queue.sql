-- Durable job queue on Postgres (no paid queue service).
--
-- Guarantees
--   * Jobs live in the database, so they survive app restarts and redeploys.
--   * A worker leases a job (locked_until). If the worker dies, the lease
--     expires and another worker picks the job up again.
--   * Every claim counts as an attempt; a job that keeps crashing or failing
--     ends up 'dead' instead of looping forever.
--   * complete/fail are fenced by worker id, so a worker that lost its lease
--     cannot overwrite the result of the worker that took over.
--   * idempotency_key: a given piece of work is enqueued at most once, ever.
--     dedupe_key: at most one queued/running job per key at a time.

alter table public.jobs
  add column dedupe_key text,
  add column priority smallint not null default 100;

create unique index jobs_dedupe_active_idx on public.jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');
drop index if exists public.jobs_ready_idx;
create index jobs_ready_idx on public.jobs (priority, run_at) where status = 'queued';
create index jobs_finished_idx on public.jobs (finished_at) where status in ('succeeded', 'dead');

-- ---------------------------------------------------------------------------
create or replace function public.enqueue_job(
  p_job_type text,
  p_payload jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_run_at timestamptz default now(),
  p_idempotency_key text default null,
  p_dedupe_key text default null,
  p_max_attempts smallint default 8,
  p_priority smallint default 100
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.jobs (job_type, payload, user_id, run_at, idempotency_key, dedupe_key, max_attempts, priority)
  values (p_job_type, coalesce(p_payload, '{}'::jsonb), p_user_id, coalesce(p_run_at, now()),
          p_idempotency_key, p_dedupe_key, p_max_attempts, p_priority)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Already enqueued. If an active duplicate exists with a later run time,
    -- pull it forward so the earliest requested time wins.
    select id into v_id from public.jobs
     where (p_idempotency_key is not null and idempotency_key = p_idempotency_key)
        or (p_dedupe_key is not null and dedupe_key = p_dedupe_key and status in ('queued', 'running'))
     order by created_at desc
     limit 1;
    update public.jobs set run_at = least(run_at, coalesce(p_run_at, now()))
     where id = v_id and status = 'queued';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function public.claim_jobs(
  p_worker text,
  p_types text[] default null,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Jobs whose worker died and that have no attempts left are parked.
  update public.jobs
     set status = 'dead', finished_at = now(), locked_by = null, locked_until = null,
         last_error = coalesce(last_error, 'lease expired after final attempt')
   where status = 'running' and locked_until < now() and attempts >= max_attempts;

  return query
  with picked as (
    select j.id
      from public.jobs j
     where ((j.status = 'queued' and j.run_at <= now())
            or (j.status = 'running' and j.locked_until < now()))
       and (p_types is null or j.job_type = any (p_types))
     order by j.priority, j.run_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_by = left(p_worker, 100),
         locked_until = now() + make_interval(secs => p_lease_seconds)
    from picked
   where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function public.complete_job(p_job_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
     set status = 'succeeded', finished_at = now(), locked_by = null, locked_until = null, last_error = null
   where id = p_job_id and status = 'running' and locked_by = p_worker;
  return found;
end;
$$;

-- Hands back a claimed job that this worker didn't start (out of time), without
-- using up an attempt.
create or replace function public.release_job(p_job_id uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
     set status = 'queued', attempts = greatest(attempts - 1, 0), locked_by = null, locked_until = null
   where id = p_job_id and status = 'running' and locked_by = p_worker;
  return found;
end;
$$;

-- Reschedules (or parks) a running job. Without p_retry_at, backs off
-- 30 s, 1 min, 2 min … capped at 1 hour.
create or replace function public.fail_job(
  p_job_id uuid,
  p_worker text,
  p_error text,
  p_retry_at timestamptz default null,
  p_permanent boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs%rowtype;
begin
  select * into j from public.jobs where id = p_job_id and status = 'running' and locked_by = p_worker for update;
  if not found then return 'lost_lease'; end if;

  if p_permanent or j.attempts >= j.max_attempts then
    update public.jobs
       set status = 'dead', finished_at = now(), locked_by = null, locked_until = null, last_error = left(p_error, 500)
     where id = p_job_id;
    return 'dead';
  end if;

  update public.jobs
     set status = 'queued',
         run_at = coalesce(p_retry_at, now() + make_interval(secs => least(3600, 30 * power(2, greatest(j.attempts - 1, 0)))::int)),
         locked_by = null, locked_until = null, last_error = left(p_error, 500)
   where id = p_job_id;
  return 'retry';
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduling helpers
-- ---------------------------------------------------------------------------

-- Enqueues one sync job per inbox that is due (respecting failure back-off).
-- The dedupe key keeps it to one active sync job per inbox.
create or replace function public.enqueue_due_syncs(p_min_interval_seconds integer default 60)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select i.id, i.user_id
      from public.connected_inboxes i
      join public.inbox_credentials c on c.inbox_id = i.id
     where i.status in ('active', 'error')
       and (i.last_synced_at is null or i.last_synced_at < now() - make_interval(secs => p_min_interval_seconds))
       and (i.consecutive_failures = 0
            or i.last_error_at is null
            or i.last_error_at < now() - make_interval(mins => least(60, power(2, least(i.consecutive_failures, 6))::int)))
       and not exists (select 1 from public.jobs j where j.dedupe_key = 'sync:' || i.id and j.status in ('queued', 'running'))
  loop
    perform public.enqueue_job('sync_inbox', jsonb_build_object('inbox_id', r.id), r.user_id, now(),
                               null, 'sync:' || r.id, 3::smallint, 50::smallint);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Everything the delivery worker needs for one notification.
create or replace function public.delivery_context(p_notification_id uuid)
returns table (
  id uuid, user_id uuid, category text, inbox_label text, received_at timestamptz,
  status text, delivery_attempts smallint, timezone text, alerts_paused boolean,
  category_enabled boolean, phone_e164 text, whatsapp_status text, sent_last_hour integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.user_id, n.category, n.inbox_label, n.received_at, n.status, n.delivery_attempts,
         coalesce(pr.timezone, 'UTC'),
         coalesce(p.alerts_paused, false),
         coalesce(case n.category
           when 'buyer_message' then p.buyer_message
           when 'new_order' then p.new_order
           when 'order_update' then p.order_update
           when 'payment' then p.payment
           when 'policy' then p.policy
           when 'account_security' then p.account_security
           when 'general' then p.general
           else p.unclassified end, false),
         w.phone_e164,
         w.status,
         (select count(*)::int from public.delivery_logs d
           where d.user_id = n.user_id and d.created_at > now() - interval '1 hour')
    from public.notifications n
    left join public.notification_preferences p on p.user_id = n.user_id
    left join public.profiles pr on pr.id = n.user_id
    left join public.whatsapp_connections w on w.user_id = n.user_id
   where n.id = p_notification_id;
$$;

-- A delivery job is created in the same transaction as the notification, so a
-- detected notification can never be "forgotten" between steps.
create or replace function public.enqueue_delivery_for_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_job('deliver_notification', jsonb_build_object('notification_id', new.id), new.user_id,
                             now(), null, 'deliver:' || new.id, 20::smallint, 10::smallint);
  return new;
end;
$$;
create trigger notifications_enqueue_delivery
  after insert on public.notifications
  for each row execute function public.enqueue_delivery_for_notification();

-- Re-define apply_delivery_status so a "failed" webhook that should be retried
-- puts a delivery job back on the queue.
create or replace function public.apply_delivery_status(
  p_provider_message_id text,
  p_status text,
  p_at timestamptz,
  p_error_code text default null,
  p_error_title text default null,
  p_pricing_category text default null,
  p_billable boolean default null,
  p_retry_at timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.delivery_logs%rowtype;
  rank_new int;
  rank_old int;
  v_latest smallint;
begin
  select * into d from public.delivery_logs where provider_message_id = p_provider_message_id for update;
  if not found then return false; end if;

  rank_new := case p_status when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 when 'failed' then 1 else -1 end;
  rank_old := case d.status when 'pending' then 0 when 'submitted' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 5 end;
  if rank_new < 0 then return false; end if;
  if p_status = 'failed' then
    if d.status in ('delivered', 'read', 'failed') then return false; end if;
  elsif rank_new <= rank_old then
    return false;
  end if;

  update public.delivery_logs
     set status = p_status,
         sent_at = case when p_status = 'sent' then p_at else coalesce(sent_at, case when p_status in ('delivered','read') then p_at end) end,
         delivered_at = case when p_status = 'delivered' then p_at when p_status = 'read' then coalesce(delivered_at, p_at) else delivered_at end,
         read_at = case when p_status = 'read' then p_at else read_at end,
         failed_at = case when p_status = 'failed' then p_at else failed_at end,
         error_code = case when p_status = 'failed' then left(p_error_code, 32) else error_code end,
         error_title = case when p_status = 'failed' then left(p_error_title, 200) else error_title end,
         pricing_category = coalesce(p_pricing_category, pricing_category),
         billable = coalesce(p_billable, billable)
   where id = d.id;

  select max(attempt) into v_latest from public.delivery_logs where notification_id = d.notification_id;
  if d.attempt = v_latest then
    update public.notifications
       set status = case
             when p_status in ('delivered', 'read') then 'delivered'
             when p_status = 'failed' and p_retry_at is not null then 'queued'
             when p_status = 'failed' then 'failed'
             else status end,
           next_attempt_at = case when p_status = 'failed' then p_retry_at else next_attempt_at end
     where id = d.notification_id and status not in ('delivered', 'skipped');

    if p_status = 'failed' and p_retry_at is not null then
      perform public.enqueue_job('deliver_notification', jsonb_build_object('notification_id', d.notification_id), d.user_id,
                                 p_retry_at, null, 'deliver:' || d.notification_id, 20::smallint, 10::smallint);
    end if;
  end if;
  return true;
end;
$$;

-- Housekeeping: finished jobs are kept 7 days (dead ones 30) for debugging.
create or replace function public.cleanup_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  delete from public.jobs
   where (status = 'succeeded' and finished_at < now() - interval '7 days')
      or (status = 'dead' and finished_at < now() - interval '30 days');
  get diagnostics v = row_count;
  return v;
end;
$$;

-- Queue health for monitoring (counts only, no payloads).
create or replace function public.queue_stats()
returns table (job_type text, status text, jobs bigint, oldest_run_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select job_type, status, count(*), min(run_at)
    from public.jobs
   where status in ('queued', 'running') or finished_at > now() - interval '24 hours'
   group by job_type, status;
$$;

-- Backfill: queue delivery for anything detected before this migration.
insert into public.jobs (job_type, payload, user_id, dedupe_key, max_attempts, priority)
select 'deliver_notification', jsonb_build_object('notification_id', n.id), n.user_id, 'deliver:' || n.id, 20, 10
  from public.notifications n
 where n.status in ('received', 'queued')
on conflict do nothing;

-- The per-row claim functions are superseded by the queue.
drop function if exists public.claim_notifications_for_delivery(integer, integer);
drop function if exists public.claim_inboxes_for_sync(integer, integer, integer);

do $$
declare f text;
begin
  foreach f in array array[
    'public.enqueue_job(text, jsonb, uuid, timestamptz, text, text, smallint, smallint)',
    'public.claim_jobs(text, text[], integer, integer)',
    'public.complete_job(uuid, text)',
    'public.release_job(uuid, text)',
    'public.fail_job(uuid, text, text, timestamptz, boolean)',
    'public.enqueue_due_syncs(integer)',
    'public.delivery_context(uuid)',
    'public.enqueue_delivery_for_notification()',
    'public.apply_delivery_status(text, text, timestamptz, text, text, text, boolean, timestamptz)',
    'public.cleanup_jobs()',
    'public.queue_stats()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if f <> 'public.enqueue_delivery_for_notification()' then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
