-- WhatsApp: number verification, opt-in/opt-out, delivery claiming, attempt
-- recording and webhook status application. All functions are service-role only.

-- ---------------------------------------------------------------------------
-- Verification send log (rate limiting across users, so nobody can use
-- PingDesk to spam an arbitrary phone number with codes).
-- ---------------------------------------------------------------------------
create table public.whatsapp_verification_sends (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  phone_e164  text not null,
  created_at  timestamptz not null default now()
);
create index whatsapp_verification_sends_phone_idx on public.whatsapp_verification_sends (phone_e164, created_at desc);
create index whatsapp_verification_sends_user_idx on public.whatsapp_verification_sends (user_id, created_at desc);
alter table public.whatsapp_verification_sends enable row level security;
revoke all on public.whatsapp_verification_sends from anon, authenticated;
grant all on public.whatsapp_verification_sends to service_role;

-- ---------------------------------------------------------------------------
-- Delivery bookkeeping on notifications
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column delivery_attempts      smallint not null default 0,
  add column next_attempt_at        timestamptz,
  add column delivery_locked_until  timestamptz;
create index notifications_delivery_due_idx on public.notifications (next_attempt_at nulls first)
  where status in ('received', 'queued');

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
create or replace function public.start_whatsapp_verification(
  p_user_id uuid,
  p_phone text,
  p_code_hash text,
  p_opt_in_version text,
  p_ttl_seconds integer default 600
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.whatsapp_connections%rowtype;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    return 'invalid_phone';
  end if;

  select * into v_existing from public.whatsapp_connections where user_id = p_user_id for update;
  if found and v_existing.phone_e164 = p_phone and v_existing.status = 'verified' then
    return 'already_verified';
  end if;

  -- 60-second resend cooldown per user
  if exists (select 1 from public.whatsapp_verification_sends
              where user_id = p_user_id and created_at > now() - interval '60 seconds') then
    return 'cooldown';
  end if;
  -- 5 codes per hour per account
  if (select count(*) from public.whatsapp_verification_sends
       where user_id = p_user_id and created_at > now() - interval '1 hour') >= 5 then
    return 'user_limit';
  end if;
  -- 5 per hour / 10 per day per phone number, across all accounts
  if (select count(*) from public.whatsapp_verification_sends
       where phone_e164 = p_phone and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.whatsapp_verification_sends
          where phone_e164 = p_phone and created_at > now() - interval '1 day') >= 10 then
    return 'phone_limit';
  end if;

  insert into public.whatsapp_verification_sends (user_id, phone_e164) values (p_user_id, p_phone);

  insert into public.whatsapp_connections as w (
    user_id, phone_e164, status, opt_in_version, opted_in_at,
    verification_code_hash, verification_expires_at, verification_attempts, verification_sends
  ) values (
    p_user_id, p_phone, 'pending_verification', p_opt_in_version, now(),
    p_code_hash, now() + make_interval(secs => p_ttl_seconds), 0, 1
  )
  on conflict (user_id) do update set
    phone_e164 = excluded.phone_e164,
    status = 'pending_verification',
    opt_in_version = excluded.opt_in_version,
    opted_in_at = now(),
    verified_at = null,
    opted_out_at = null,
    verification_code_hash = excluded.verification_code_hash,
    verification_expires_at = excluded.verification_expires_at,
    verification_attempts = 0,
    verification_sends = least(w.verification_sends + 1, 32000);
  return 'ok';
end;
$$;

create or replace function public.confirm_whatsapp_verification(
  p_user_id uuid,
  p_code_hash text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.whatsapp_connections%rowtype;
begin
  select * into v from public.whatsapp_connections where user_id = p_user_id for update;
  if not found or v.status <> 'pending_verification' or v.verification_code_hash is null then
    return 'none';
  end if;
  if v.verification_attempts >= 5 then
    return 'locked';
  end if;
  if v.verification_expires_at < now() then
    return 'expired';
  end if;
  if v.verification_code_hash <> p_code_hash then
    update public.whatsapp_connections
       set verification_attempts = verification_attempts + 1
     where user_id = p_user_id;
    return case when v.verification_attempts + 1 >= 5 then 'locked' else 'invalid' end;
  end if;

  update public.whatsapp_connections
     set status = 'verified',
         verified_at = now(),
         verification_code_hash = null,
         verification_expires_at = null,
         verification_attempts = 0
   where user_id = p_user_id;
  return 'verified';
end;
$$;

-- Inbound "STOP"/"START" replies and the 24-hour customer-service window.
create or replace function public.whatsapp_inbound(
  p_phone text,
  p_action text  -- 'stop' | 'start' | 'message'
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.whatsapp_connections
     set last_inbound_at = now(),
         status = case
           when p_action = 'stop' and status = 'verified' then 'opted_out'
           when p_action = 'start' and status = 'opted_out' and verified_at is not null then 'verified'
           else status end,
         opted_out_at = case when p_action = 'stop' and status = 'verified' then now()
                             when p_action = 'start' and status = 'opted_out' then null
                             else opted_out_at end,
         opted_in_at = case when p_action = 'start' and status = 'opted_out' then now() else opted_in_at end
   where phone_e164 = p_phone;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery
-- ---------------------------------------------------------------------------
create or replace function public.claim_notifications_for_delivery(
  p_limit integer default 25,
  p_lease_seconds integer default 120
) returns table (
  id uuid,
  user_id uuid,
  category text,
  inbox_label text,
  received_at timestamptz,
  delivery_attempts smallint,
  timezone text,
  alerts_paused boolean,
  category_enabled boolean,
  phone_e164 text,
  whatsapp_status text,
  sent_last_hour integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select n.id
      from public.notifications n
     where n.status in ('received', 'queued')
       and (n.next_attempt_at is null or n.next_attempt_at <= now())
       and (n.delivery_locked_until is null or n.delivery_locked_until < now())
     order by n.received_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  ), leased as (
    update public.notifications n
       set delivery_locked_until = now() + make_interval(secs => p_lease_seconds)
      from due
     where n.id = due.id
    returning n.id, n.user_id, n.category, n.inbox_label, n.received_at, n.delivery_attempts
  )
  select l.id, l.user_id, l.category, l.inbox_label, l.received_at, l.delivery_attempts,
         coalesce(pr.timezone, 'UTC'),
         coalesce(p.alerts_paused, false),
         coalesce(case l.category
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
           where d.user_id = l.user_id and d.created_at > now() - interval '1 hour')
    from leased l
    left join public.notification_preferences p on p.user_id = l.user_id
    left join public.profiles pr on pr.id = l.user_id
    left join public.whatsapp_connections w on w.user_id = l.user_id;
end;
$$;

-- Records the result of one delivery decision/attempt and releases the lease.
--   p_outcome: 'submitted' | 'retry' | 'failed' | 'skipped' | 'deferred'
create or replace function public.record_delivery_attempt(
  p_notification_id uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_title text default null,
  p_retry_at timestamptz default null,
  p_skip_reason text default null,
  p_template_name text default null,
  p_recipient_last4 text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notifications%rowtype;
  v_attempt smallint;
begin
  select * into n from public.notifications where id = p_notification_id for update;
  if not found then return; end if;

  if p_outcome = 'skipped' then
    update public.notifications
       set status = 'skipped', skip_reason = left(p_skip_reason, 40), delivery_locked_until = null, next_attempt_at = null
     where id = p_notification_id;
    return;
  end if;

  if p_outcome = 'deferred' then  -- e.g. per-user hourly cap: try later, no attempt used
    update public.notifications
       set status = 'queued', next_attempt_at = p_retry_at, delivery_locked_until = null
     where id = p_notification_id;
    return;
  end if;

  v_attempt := n.delivery_attempts + 1;
  insert into public.delivery_logs (
    notification_id, user_id, attempt, recipient_last4, template_name, provider_message_id,
    status, error_code, error_title, submitted_at, failed_at
  ) values (
    n.id, n.user_id, v_attempt, p_recipient_last4, p_template_name, p_provider_message_id,
    case when p_outcome = 'submitted' then 'submitted' else 'failed' end,
    left(p_error_code, 32), left(p_error_title, 200),
    case when p_outcome = 'submitted' then now() end,
    case when p_outcome <> 'submitted' then now() end
  );

  update public.notifications
     set delivery_attempts = v_attempt,
         status = case p_outcome when 'submitted' then 'delivering' when 'retry' then 'queued' else 'failed' end,
         next_attempt_at = case when p_outcome = 'retry' then p_retry_at end,
         delivery_locked_until = null
   where id = p_notification_id;
end;
$$;

-- Applies a webhook status to a delivery log, never moving backwards, and
-- reflects it on the notification if this log is the latest attempt.
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
  -- failed only applies before delivery; other statuses only move forward
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
  end if;
  return true;
end;
$$;

revoke all on function public.start_whatsapp_verification(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.confirm_whatsapp_verification(uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_inbound(text, text) from public, anon, authenticated;
revoke all on function public.claim_notifications_for_delivery(integer, integer) from public, anon, authenticated;
revoke all on function public.record_delivery_attempt(uuid, text, text, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_delivery_status(text, text, timestamptz, text, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.start_whatsapp_verification(uuid, text, text, text, integer) to service_role;
grant execute on function public.confirm_whatsapp_verification(uuid, text) to service_role;
grant execute on function public.whatsapp_inbound(text, text) to service_role;
grant execute on function public.claim_notifications_for_delivery(integer, integer) to service_role;
grant execute on function public.record_delivery_attempt(uuid, text, text, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public.apply_delivery_status(text, text, timestamptz, text, text, text, boolean, timestamptz) to service_role;
