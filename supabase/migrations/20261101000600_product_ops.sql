-- Phase 5: activity log, data retention, rate limiting, "check now", test
-- alerts and operator monitoring.

-- ---------------------------------------------------------------------------
-- Activity log (user-visible audit trail). No secrets or message content.
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null check (event ~ '^[a-z_]+\.[a-z_]+$'),
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_events_user_created_idx on public.audit_events (user_id, created_at desc);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;
create policy audit_events_select_own on public.audit_events
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Retention preference
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column retention_days smallint not null default 90 check (retention_days in (30, 90, 180, 365));
grant update (retention_days) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Fixed-window rate limiter (service role only)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Returns true if the action is allowed (and counts it), false if over limit.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (key, window_start, hits) values (left(p_key, 200), v_window, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Check now": queue an immediate sync for one of the user's inboxes.
-- ---------------------------------------------------------------------------
create or replace function public.request_sync_now(p_user_id uuid, p_inbox_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.connected_inboxes i join public.inbox_credentials c on c.inbox_id = i.id
     where i.id = p_inbox_id and i.user_id = p_user_id and i.status in ('active', 'error')
  ) then
    return 'not_found';
  end if;
  if not public.rate_limit_hit('sync_now:' || p_inbox_id, 6, 3600) then
    return 'rate_limited';
  end if;
  perform public.enqueue_job('sync_inbox', jsonb_build_object('inbox_id', p_inbox_id), p_user_id, now(),
                             null, 'sync:' || p_inbox_id, 3::smallint, 40::smallint);
  return 'queued';
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention (run daily by the maintenance job)
-- ---------------------------------------------------------------------------
create or replace function public.run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notifications integer;
  v_audit integer;
  v_sends integer;
  v_limits integer;
  v_jobs integer;
begin
  delete from public.notifications n
   using public.profiles p
   where p.id = n.user_id
     and n.received_at < now() - make_interval(days => p.retention_days)
     and n.status in ('delivered', 'failed', 'skipped');
  get diagnostics v_notifications = row_count;

  delete from public.audit_events where created_at < now() - interval '365 days';
  get diagnostics v_audit = row_count;

  delete from public.whatsapp_verification_sends where created_at < now() - interval '2 days';
  get diagnostics v_sends = row_count;

  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics v_limits = row_count;

  v_jobs := public.cleanup_jobs();

  return jsonb_build_object('notifications', v_notifications, 'audit_events', v_audit,
                            'verification_sends', v_sends, 'rate_limits', v_limits, 'jobs', v_jobs);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator monitoring: aggregate counts only, no personal data.
-- ---------------------------------------------------------------------------
create or replace function public.ops_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'inboxes', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                  from (select status, count(*) n from public.connected_inboxes group by status) s),
    'whatsapp', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                   from (select status, count(*) n from public.whatsapp_connections group by status) s),
    'notifications_24h', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                            from (select status, count(*) n from public.notifications
                                   where created_at > now() - interval '24 hours' group by status) s),
    'delivery_errors_24h', (select coalesce(jsonb_object_agg(error_code, n), '{}'::jsonb)
                              from (select error_code, count(*) n from public.delivery_logs
                                     where status = 'failed' and created_at > now() - interval '24 hours'
                                     group by error_code) s),
    'queue', jsonb_build_object(
      'queued', (select count(*) from public.jobs where status = 'queued'),
      'due', (select count(*) from public.jobs where status = 'queued' and run_at <= now()),
      'oldest_due_seconds', (select coalesce(extract(epoch from now() - min(run_at))::int, 0)
                               from public.jobs where status = 'queued' and run_at <= now()),
      'running', (select count(*) from public.jobs where status = 'running'),
      'expired_leases', (select count(*) from public.jobs where status = 'running' and locked_until < now()),
      'dead_24h', (select count(*) from public.jobs where status = 'dead' and finished_at > now() - interval '24 hours')
    ),
    'last_sync_at', (select max(last_synced_at) from public.connected_inboxes),
    'generated_at', now()
  );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.rate_limit_hit(text, integer, integer)',
    'public.request_sync_now(uuid, uuid)',
    'public.run_retention()',
    'public.ops_status()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
