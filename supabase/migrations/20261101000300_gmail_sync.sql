-- Gmail sync bookkeeping: leases so overlapping scheduler runs never sync the
-- same inbox twice, reconciliation timestamps, and failure tracking.

alter table public.connected_inboxes
  add column last_reconciled_at    timestamptz,
  add column consecutive_failures  smallint not null default 0,
  add column sync_locked_until     timestamptz;

-- Claims up to p_limit active inboxes that are due for a sync and leases them
-- for p_lease_seconds. Uses SKIP LOCKED so concurrent workers never collide.
-- A lease that expires (worker crashed) makes the inbox claimable again.
create or replace function public.claim_inboxes_for_sync(
  p_limit integer default 10,
  p_lease_seconds integer default 120,
  p_min_interval_seconds integer default 60
) returns table (
  id uuid,
  user_id uuid,
  label text,
  email_address text,
  last_history_id text,
  last_synced_at timestamptz,
  last_reconciled_at timestamptz,
  encrypted_refresh_token text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select i.id
      from public.connected_inboxes i
      join public.inbox_credentials c on c.inbox_id = i.id
     where i.status in ('active', 'error')
       and (i.sync_locked_until is null or i.sync_locked_until < now())
       and (i.last_synced_at is null
            or i.last_synced_at < now() - make_interval(secs => p_min_interval_seconds))
       -- back off inboxes that keep failing: 2, 4, 8 … up to 60 minutes
       and (i.consecutive_failures = 0
            or i.last_error_at is null
            or i.last_error_at < now() - make_interval(mins => least(60, power(2, least(i.consecutive_failures, 6))::int)))
     order by i.last_synced_at nulls first
     limit greatest(1, least(p_limit, 100))
     for update of i skip locked
  ), leased as (
    update public.connected_inboxes i
       set sync_locked_until = now() + make_interval(secs => p_lease_seconds)
      from due
     where i.id = due.id
    returning i.id, i.user_id, i.label, i.email_address, i.last_history_id, i.last_synced_at, i.last_reconciled_at
  )
  select l.id, l.user_id, l.label, l.email_address, l.last_history_id, l.last_synced_at, l.last_reconciled_at,
         c.encrypted_refresh_token
    from leased l
    join public.inbox_credentials c on c.inbox_id = l.id;
end;
$$;

-- Records the outcome of a sync run and releases the lease.
--   success:      p_error_code null  -> cursor saved, failures reset
--   needs reauth: p_needs_reauth     -> status needs_reauth (user must reconnect)
--   transient:    p_error_code set   -> failures++, status 'error' after 5 in a row
create or replace function public.finish_inbox_sync(
  p_inbox_id uuid,
  p_history_id text,
  p_reconciled boolean,
  p_error_code text default null,
  p_needs_reauth boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code is null then
    update public.connected_inboxes
       set last_history_id = coalesce(p_history_id, last_history_id),
           last_synced_at = now(),
           last_reconciled_at = case when p_reconciled then now() else last_reconciled_at end,
           consecutive_failures = 0,
           last_error_code = null,
           last_error_at = null,
           status = case when status = 'error' then 'active' else status end,
           sync_locked_until = null
     where id = p_inbox_id and status <> 'disconnected';
  elsif p_needs_reauth then
    update public.connected_inboxes
       set status = 'needs_reauth',
           last_error_code = left(p_error_code, 64),
           last_error_at = now(),
           sync_locked_until = null
     where id = p_inbox_id and status <> 'disconnected';
  else
    update public.connected_inboxes
       set consecutive_failures = least(consecutive_failures + 1, 1000),
           last_error_code = left(p_error_code, 64),
           last_error_at = now(),
           status = case when consecutive_failures + 1 >= 5 and status = 'active' then 'error' else status end,
           -- keep progress made before the failure
           last_history_id = coalesce(p_history_id, last_history_id),
           sync_locked_until = null
     where id = p_inbox_id and status <> 'disconnected';
  end if;
end;
$$;

revoke all on function public.claim_inboxes_for_sync(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_inbox_sync(uuid, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_inboxes_for_sync(integer, integer, integer) to service_role;
grant execute on function public.finish_inbox_sync(uuid, text, boolean, text, boolean) to service_role;
