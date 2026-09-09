-- Reduce database I/O on the email scheduler, lead dashboards and sourced-lead imports.
-- Business records are retained. Completed enrollments and their four-send guard
-- are deliberately untouched.

alter table public.sent_emails
  add column if not exists is_followup boolean not null default false;

with ranked as (
  select id,
    row_number() over (partition by enrollment_id order by sent_at, id) > 1 as followup
  from public.sent_emails
  where enrollment_id is not null
    and status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
)
update public.sent_emails se
set is_followup = ranked.followup
from ranked
where se.id = ranked.id
  and se.is_followup is distinct from ranked.followup;

create index if not exists sent_emails_sender_kind_sent_idx
  on public.sent_emails (sender_id, is_followup, sent_at desc)
  where status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed');

create table if not exists public.email_send_reservations (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.senders(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  user_id uuid not null,
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  is_followup boolean not null,
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  consumed_at timestamptz
);

alter table public.email_send_reservations enable row level security;
revoke all on table public.email_send_reservations from public, anon, authenticated;
grant all on table public.email_send_reservations to service_role;

create index if not exists email_send_reservations_active_sender_idx
  on public.email_send_reservations (sender_id, is_followup, expires_at)
  where consumed_at is null;
create index if not exists email_send_reservations_active_sequence_idx
  on public.email_send_reservations (sequence_id, is_followup, expires_at)
  where consumed_at is null;

create or replace function public.get_sender_capacity_snapshot(_sender_ids uuid[])
returns table (
  sender_id uuid,
  first_remaining integer,
  followup_remaining integer,
  first_last_sent_at timestamptz,
  followup_last_sent_at timestamptz,
  sender_domain text,
  domain_remaining integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select s.id, s.from_email,
      split_part(lower(s.from_email), '@', 2) as domain,
      public.sender_warmup_quota(s.id) as first_quota,
      case
        when coalesce(s.warmup_enabled, false) and s.warmup_started_at is not null
          then least(
            public.sender_warmup_quota(s.id) * greatest(1, coalesce(s.followup_multiplier, 3)),
            greatest(3, ceil(public.sender_warmup_quota(s.id)::numeric * .5)::integer)
          )
        else public.sender_warmup_quota(s.id) * greatest(1, coalesce(s.followup_multiplier, 3))
      end as followup_quota
    from public.senders s
    where s.id = any(_sender_ids) and s.is_active = true
  ), usage as (
    select se.sender_id,
      count(*) filter (where not se.is_followup)::integer as first_used,
      count(*) filter (where se.is_followup)::integer as followup_used,
      max(se.sent_at) filter (where not se.is_followup) as first_last,
      max(se.sent_at) filter (where se.is_followup) as followup_last
    from public.sent_emails se
    where se.sender_id = any(_sender_ids)
      and se.status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
      and se.sent_at >= date_trunc('day', timezone('Europe/Stockholm', now())) at time zone 'Europe/Stockholm'
    group by se.sender_id
  ), reserved as (
    select r.sender_id,
      count(*) filter (where not r.is_followup)::integer as first_reserved,
      count(*) filter (where r.is_followup)::integer as followup_reserved
    from public.email_send_reservations r
    where r.sender_id = any(_sender_ids)
      and r.consumed_at is null and r.expires_at > now()
    group by r.sender_id
  ), domains as (
    select split_part(lower(s.from_email), '@', 2) as domain,
      least(80, sum(
        public.sender_warmup_quota(s.id)
        + case
            when coalesce(s.warmup_enabled, false) and s.warmup_started_at is not null
              then least(
                public.sender_warmup_quota(s.id) * greatest(1, coalesce(s.followup_multiplier, 3)),
                greatest(3, ceil(public.sender_warmup_quota(s.id)::numeric * .5)::integer)
              )
            else public.sender_warmup_quota(s.id) * greatest(1, coalesce(s.followup_multiplier, 3))
          end
      ))::integer as cap
    from public.senders s
    where s.is_active = true
      and split_part(lower(s.from_email), '@', 2) in (select domain from requested)
    group by 1
  ), domain_usage as (
    select split_part(lower(s.from_email), '@', 2) as domain, count(*)::integer as used
    from public.sent_emails se
    join public.senders s on s.id = se.sender_id
    where split_part(lower(s.from_email), '@', 2) in (select domain from requested)
      and se.status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
      and se.sent_at >= date_trunc('day', timezone('Europe/Stockholm', now())) at time zone 'Europe/Stockholm'
    group by 1
  ), domain_reserved as (
    select split_part(lower(s.from_email), '@', 2) as domain, count(*)::integer as reserved
    from public.email_send_reservations r
    join public.senders s on s.id = r.sender_id
    where split_part(lower(s.from_email), '@', 2) in (select domain from requested)
      and r.consumed_at is null and r.expires_at > now()
    group by 1
  )
  select q.id,
    greatest(0, q.first_quota - coalesce(u.first_used, 0) - coalesce(r.first_reserved, 0)),
    greatest(0, q.followup_quota - coalesce(u.followup_used, 0) - coalesce(r.followup_reserved, 0)),
    u.first_last,
    u.followup_last,
    q.domain,
    greatest(0, coalesce(d.cap, 80) - coalesce(du.used, 0) - coalesce(dr.reserved, 0))
  from requested q
  left join usage u on u.sender_id = q.id
  left join reserved r on r.sender_id = q.id
  left join domains d on d.domain = q.domain
  left join domain_usage du on du.domain = q.domain
  left join domain_reserved dr on dr.domain = q.domain;
$$;

create or replace function public.get_sequence_first_touch_count(_sequence_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.sent_emails se
  join public.enrollments e on e.id = se.enrollment_id
  where e.sequence_id = _sequence_id
    and se.is_followup = false
    and se.status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
    and se.sent_at >= date_trunc('day', timezone('Europe/Stockholm', now())) at time zone 'Europe/Stockholm';
$$;

create or replace function public.reserve_email_send(
  _sender_id uuid,
  _enrollment_id uuid,
  _contact_id uuid,
  _user_id uuid,
  _sequence_id uuid,
  _is_followup boolean,
  _sequence_daily_cap integer default null
)
returns table (reservation_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender public.senders%rowtype;
  v_domain text;
  v_first_quota integer;
  v_followup_quota integer;
  v_sender_used integer;
  v_domain_cap integer;
  v_domain_used integer;
  v_sequence_used integer;
  v_id uuid;
  v_day_start timestamptz := date_trunc('day', timezone('Europe/Stockholm', now())) at time zone 'Europe/Stockholm';
begin
  select * into v_sender from public.senders where id = _sender_id and is_active = true;
  if not found then return query select null::uuid, 'sender_unavailable'::text; return; end if;
  v_domain := split_part(lower(v_sender.from_email), '@', 2);

  -- Domain lock serialises all senders which share reputation/capacity. The
  -- enrollment lock also prevents simultaneous reservations for one contact.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-domain:' || v_domain, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-enrollment:' || _enrollment_id::text, 0));

  if exists (
    select 1 from public.sent_emails
    where enrollment_id = _enrollment_id
      and status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
    group by enrollment_id having count(*) >= 4
  ) then return query select null::uuid, 'sequence_complete'::text; return; end if;

  if exists (
    select 1 from public.sent_emails
    where user_id = _user_id and contact_id = _contact_id
      and status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
      and sent_at >= v_day_start
  ) then return query select null::uuid, 'already_sent_today'::text; return; end if;

  if exists (
    select 1 from public.email_send_reservations
    where enrollment_id = _enrollment_id and consumed_at is null and expires_at > now()
  ) then return query select null::uuid, 'already_reserved'::text; return; end if;

  v_first_quota := public.sender_warmup_quota(_sender_id);
  if coalesce(v_sender.warmup_enabled, false) and v_sender.warmup_started_at is not null then
    v_followup_quota := least(
      v_first_quota * greatest(1, coalesce(v_sender.followup_multiplier, 3)),
      greatest(3, ceil(v_first_quota::numeric * .5)::integer)
    );
  else
    v_followup_quota := v_first_quota * greatest(1, coalesce(v_sender.followup_multiplier, 3));
  end if;

  select count(*)::integer into v_sender_used from (
    select id from public.sent_emails
    where sender_id = _sender_id and is_followup = _is_followup
      and status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed') and sent_at >= v_day_start
    union all
    select id from public.email_send_reservations
    where sender_id = _sender_id and is_followup = _is_followup
      and consumed_at is null and expires_at > now()
  ) used;
  if v_sender_used >= (case when _is_followup then v_followup_quota else v_first_quota end) then
    return query select null::uuid, 'sender_capacity'::text; return;
  end if;

  select least(80, sum(public.sender_warmup_quota(s.id) +
    case when coalesce(s.warmup_enabled, false) and s.warmup_started_at is not null
      then least(public.sender_warmup_quota(s.id) * greatest(1, coalesce(s.followup_multiplier, 3)), greatest(3, ceil(public.sender_warmup_quota(s.id)::numeric * .5)::integer))
      else public.sender_warmup_quota(s.id) * greatest(1, coalesce(s.followup_multiplier, 3)) end
  ))::integer into v_domain_cap
  from public.senders s where s.is_active = true and split_part(lower(s.from_email), '@', 2) = v_domain;

  select count(*)::integer into v_domain_used from (
    select se.id from public.sent_emails se join public.senders s on s.id = se.sender_id
    where split_part(lower(s.from_email), '@', 2) = v_domain
      and se.status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed') and se.sent_at >= v_day_start
    union all
    select r.id from public.email_send_reservations r join public.senders s on s.id = r.sender_id
    where split_part(lower(s.from_email), '@', 2) = v_domain
      and r.consumed_at is null and r.expires_at > now()
  ) used;
  if v_domain_used >= coalesce(v_domain_cap, 80) then
    return query select null::uuid, 'domain_capacity'::text; return;
  end if;

  if not _is_followup and coalesce(_sequence_daily_cap, 0) > 0 then
    select count(*)::integer into v_sequence_used from (
      select se.id from public.sent_emails se join public.enrollments e on e.id = se.enrollment_id
      where e.sequence_id = _sequence_id and se.is_followup = false
        and se.status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed') and se.sent_at >= v_day_start
      union all
      select r.id from public.email_send_reservations r
      where r.sequence_id = _sequence_id and r.is_followup = false
        and r.consumed_at is null and r.expires_at > now()
    ) used;
    if v_sequence_used >= _sequence_daily_cap then
      return query select null::uuid, 'sequence_capacity'::text; return;
    end if;
  end if;

  insert into public.email_send_reservations(sender_id, enrollment_id, contact_id, user_id, sequence_id, is_followup)
  values (_sender_id, _enrollment_id, _contact_id, _user_id, _sequence_id, _is_followup)
  returning id into v_id;
  return query select v_id, 'reserved'::text;
end;
$$;

revoke all on function public.get_sender_capacity_snapshot(uuid[]) from public, anon, authenticated;
revoke all on function public.get_sequence_first_touch_count(uuid) from public, anon, authenticated;
revoke all on function public.reserve_email_send(uuid, uuid, uuid, uuid, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.get_sender_capacity_snapshot(uuid[]) to service_role;
grant execute on function public.get_sequence_first_touch_count(uuid) to service_role;
grant execute on function public.reserve_email_send(uuid, uuid, uuid, uuid, uuid, boolean, integer) to service_role;

create or replace function public.get_site_lead_counts(p_language text default null)
returns table (status text, language text, count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select sl.status, coalesce(sl.language, 'sv'), count(*)::bigint
  from public.site_leads sl
  where sl.user_id = (select auth.uid())
    and (p_language is null or coalesce(sl.language, 'sv') = p_language)
  group by sl.status, coalesce(sl.language, 'sv');
$$;
revoke all on function public.get_site_lead_counts(text) from public, anon;
grant execute on function public.get_site_lead_counts(text) to authenticated, service_role;

create or replace function public.get_lead_stock_counts(_user_id uuid, _language text)
returns table (pipeline_count bigint, unsent_approved_count bigint, audit_backlog bigint, review_backlog bigint, build_backlog bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where sl.status in ('pending_audit','auditing','awaiting_audit_approval','needs_site','generating','awaiting_approval')),
    count(*) filter (where sl.status in ('approved','auto_approved') and sl.last_email_sent_at is null),
    count(*) filter (where sl.status in ('pending_audit','auditing')),
    count(*) filter (where sl.status in ('awaiting_audit_approval','awaiting_approval','needs_triage')),
    count(*) filter (where sl.status in ('needs_site','generating'))
  from public.site_leads sl
  where sl.user_id = _user_id and coalesce(sl.language, 'sv') = _language
    and sl.email is not null and sl.email <> '' and sl.website is not null and sl.website <> '';
$$;
revoke all on function public.get_lead_stock_counts(uuid, text) from public, anon, authenticated;
grant execute on function public.get_lead_stock_counts(uuid, text) to service_role;

create or replace function public.ingest_sourced_leads_batch(
  _job_id uuid,
  _user_id uuid,
  _language text,
  _rows jsonb
)
returns table (imported integer, duplicates integer, rejected integer, failed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  lead_id uuid;
  existing_id uuid;
  imported_n integer := 0;
  duplicate_n integer := 0;
  rejected_n integer := 0;
  failed_n integer := 0;
  outcome text;
  reason text;
begin
  if jsonb_typeof(_rows) is distinct from 'array' then raise exception '_rows must be an array'; end if;
  if not exists (select 1 from public.lead_scrape_jobs where id = _job_id and user_id = _user_id) then
    raise exception 'lead sourcing job not found';
  end if;

  for item in select value from jsonb_array_elements(_rows)
  loop
    lead_id := null; existing_id := null; reason := null;
    if coalesce(item->>'contactable', 'false') <> 'true' then
      outcome := 'rejected'; reason := 'missing a usable website or email'; rejected_n := rejected_n + 1;
    else
      select sl.id into existing_id
      from public.site_leads sl
      where sl.user_id = _user_id and (
        ((item->>'place_id') is not null and sl.source_provider = 'google_maps' and sl.source_place_id = item->>'place_id')
        or ((item->>'domain') is not null and sl.company_name_normalized = item->>'normalized_name' and sl.domain_normalized = item->>'domain')
        or ((item->>'email') is not null and lower(sl.email) = lower(item->>'email'))
        or ((item->>'website') is not null and sl.website = item->>'website')
      ) limit 1;

      if existing_id is not null then
        outcome := 'duplicate'; reason := 'matches an existing lead'; duplicate_n := duplicate_n + 1;
      else
        begin
          insert into public.site_leads(
            user_id, company_name, company_name_normalized, domain, domain_normalized,
            website, email, phone, address, category, rating, reviews_count,
            language, niche, status, source_provider, source_place_id, source_job_id, source_market_id
          )
          select _user_id, item->>'company_name', item->>'normalized_name', item->>'domain', item->>'domain',
            item->>'website', item->>'email', item->>'phone', item->>'address', item->>'category',
            nullif(item->>'rating','')::numeric, nullif(item->>'reviews_count','')::integer,
            _language, coalesce(nullif(item->>'niche',''), 'other'), 'pending_audit', 'google_maps',
            item->>'place_id', _job_id, j.market_id
          from public.lead_scrape_jobs j where j.id = _job_id
          returning id into lead_id;
          outcome := 'imported'; imported_n := imported_n + 1;
        exception when unique_violation then
          outcome := 'duplicate'; reason := 'already imported'; duplicate_n := duplicate_n + 1;
        when others then
          outcome := 'failed'; reason := left(sqlerrm, 400); failed_n := failed_n + 1;
        end;
      end if;
    end if;

    insert into public.lead_scrape_results(job_id, place_id, company_name, website, email, outcome, rejection_reason, site_lead_id, source_snapshot)
    values (_job_id, item->>'place_id', item->>'company_name', item->>'website', item->>'email', outcome, reason, lead_id, coalesce(item->'snapshot','{}'::jsonb))
    on conflict do nothing;
  end loop;
  return query select imported_n, duplicate_n, rejected_n, failed_n;
end;
$$;
revoke all on function public.ingest_sourced_leads_batch(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_sourced_leads_batch(uuid, uuid, text, jsonb) to service_role;

create table if not exists public.site_scrape_cache (
  site_lead_id uuid primary key references public.site_leads(id) on delete cascade,
  url text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days')
);
alter table public.site_scrape_cache enable row level security;
revoke all on table public.site_scrape_cache from public, anon, authenticated;
grant all on table public.site_scrape_cache to service_role;
create index if not exists site_scrape_cache_expiry_idx on public.site_scrape_cache(expires_at);

-- Retain enough operational history for debugging while preventing the two
-- internal log tables from growing without bound. This does not delete business data.
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname in ('prune-cron-job-history','prune-pg-net-response-history','prune-email-send-reservations','prune-site-scrape-cache')
  loop perform cron.unschedule(j); end loop;
end $$;

select cron.schedule('prune-cron-job-history', '23 3 * * *',
  $cron$delete from cron.job_run_details where end_time < now() - interval '3 days'$cron$);
select cron.schedule('prune-pg-net-response-history', '31 */6 * * *',
  $cron$delete from net._http_response where created < now() - interval '6 hours'$cron$);
select cron.schedule('prune-email-send-reservations', '41 3 * * *',
  $cron$delete from public.email_send_reservations where expires_at < now() - interval '1 day'$cron$);
select cron.schedule('prune-site-scrape-cache', '49 3 * * *',
  $cron$delete from public.site_scrape_cache where expires_at < now()$cron$);
