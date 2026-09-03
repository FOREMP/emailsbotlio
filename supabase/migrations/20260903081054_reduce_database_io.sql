-- Reduce database write amplification and large client-side analytics reads.
-- This migration never deletes business records such as contacts, sent emails,
-- generated sites, demo URLs, unsubscribe records, or lead history.

-- Hot path: run-sequences reads the send history for each enrollment.
create index if not exists idx_sent_emails_enrollment_sent
  on public.sent_emails (enrollment_id, sent_at desc)
  where enrollment_id is not null;

-- Same-day duplicate guard. The existing (user_id, sent_at) index remains useful
-- for broad user analytics; this narrower index avoids filtering every daily row.
create index if not exists idx_sent_emails_user_contact_sent
  on public.sent_emails (user_id, contact_id, sent_at desc)
  where contact_id is not null;

-- Exact duplicates make every write update two identical B-tree structures.
drop index if exists public.idx_enrollments_status_next_send_at;
drop index if exists public.enrollments_sequence_contact_unique;
drop index if exists public.idx_sent_emails_message_id;

-- Keep operational history long enough for debugging without retaining months of
-- pg_cron and pg_net bookkeeping. These are internal request/job logs only.
do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname in (
      'prune-cron-job-history',
      'prune-pg-net-response-history'
    )
  loop
    perform cron.unschedule(existing_job);
  end loop;
end;
$$;

select cron.schedule(
  'prune-cron-job-history',
  '23 3 * * *',
  $cron$delete from cron.job_run_details where end_time < now() - interval '14 days'$cron$
);

select cron.schedule(
  'prune-pg-net-response-history',
  '31 3 * * *',
  $cron$delete from net._http_response where created < now() - interval '1 day'$cron$
);

-- One PostgREST request imports an entire browser batch. ON CONFLICT DO NOTHING
-- preserves the existing unique lead rule and never overwrites an old lead.
create or replace function public.insert_site_leads_batch(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  insert into public.site_leads (
    user_id,
    company_name,
    company_name_normalized,
    domain,
    domain_normalized,
    website,
    email,
    phone,
    address,
    category,
    rating,
    reviews_count,
    review_snippets,
    language,
    status,
    niche,
    source_file_id
  )
  select
    row.user_id,
    row.company_name,
    row.company_name_normalized,
    row.domain,
    row.domain_normalized,
    row.website,
    row.email,
    row.phone,
    row.address,
    row.category,
    row.rating,
    row.reviews_count,
    coalesce(row.review_snippets, '[]'::jsonb),
    row.language,
    row.status,
    row.niche,
    row.source_file_id
  from jsonb_to_recordset(p_rows) as row(
    user_id uuid,
    company_name text,
    company_name_normalized text,
    domain text,
    domain_normalized text,
    website text,
    email text,
    phone text,
    address text,
    category text,
    rating numeric,
    reviews_count integer,
    review_snippets jsonb,
    language text,
    status text,
    niche text,
    source_file_id uuid
  )
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.insert_site_leads_batch(jsonb) from public, anon, authenticated;
grant execute on function public.insert_site_leads_batch(jsonb) to service_role;

-- Aggregate outreach analytics inside Postgres instead of downloading thousands
-- of email rows and enrollment ids into the browser. SECURITY INVOKER keeps RLS.
create or replace function public.get_site_outreach_stats(
  p_sequence_id uuid,
  p_since timestamptz
)
returns table (
  day text,
  step_index integer,
  sent bigint,
  delivered bigint,
  trackable bigint,
  opened bigint,
  replied bigint,
  bounced bigint,
  complained bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ranked as (
    select
      se.sent_at,
      se.status,
      se.tracking_enabled,
      se.opened_at,
      se.replied_at,
      row_number() over (
        partition by se.enrollment_id
        order by se.sent_at asc, se.id asc
      )::integer as step_index
    from public.sent_emails se
    join public.enrollments e on e.id = se.enrollment_id
    where e.sequence_id = p_sequence_id
      and se.status in ('queued', 'sent', 'bounced', 'complained', 'unsubscribed')
  )
  select
    to_char(r.sent_at at time zone 'Europe/Stockholm', 'YYYY-MM-DD') as day,
    least(r.step_index, 4) as step_index,
    count(*)::bigint as sent,
    count(*) filter (where r.status <> 'bounced')::bigint as delivered,
    count(*) filter (
      where r.tracking_enabled and r.status <> 'bounced'
    )::bigint as trackable,
    count(*) filter (
      where r.tracking_enabled and r.opened_at is not null
    )::bigint as opened,
    count(*) filter (where r.replied_at is not null)::bigint as replied,
    count(*) filter (where r.status = 'bounced')::bigint as bounced,
    count(*) filter (where r.status = 'complained')::bigint as complained
  from ranked r
  where r.sent_at >= p_since
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.get_site_outreach_stats(uuid, timestamptz) from public, anon;
grant execute on function public.get_site_outreach_stats(uuid, timestamptz) to authenticated, service_role;

create or replace function public.get_site_outreach_queue_counts(p_sequence_id uuid)
returns table (
  total bigint,
  active bigint,
  waiting_first bigint,
  waiting_followup bigint,
  completed bigint,
  stopped bigint,
  new_last_24h bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::bigint as total,
    count(*) filter (where status in ('active', 'waiting_capacity'))::bigint as active,
    count(*) filter (
      where status in ('active', 'waiting_capacity') and last_sent_at is null
    )::bigint as waiting_first,
    count(*) filter (
      where status in ('active', 'waiting_capacity') and last_sent_at is not null
    )::bigint as waiting_followup,
    count(*) filter (where status = 'completed')::bigint as completed,
    count(*) filter (where status in ('stopped', 'unsubscribed'))::bigint as stopped,
    count(*) filter (where created_at >= now() - interval '24 hours')::bigint as new_last_24h
  from public.enrollments
  where sequence_id = p_sequence_id;
$$;

revoke all on function public.get_site_outreach_queue_counts(uuid) from public, anon;
grant execute on function public.get_site_outreach_queue_counts(uuid) to authenticated, service_role;

create or replace function public.get_site_outreach_recent(
  p_sequence_id uuid,
  p_limit integer default 5
)
returns table (
  id uuid,
  sent_at timestamptz,
  subject text,
  body text,
  recipient_email text,
  status text,
  open_count integer,
  opened_at timestamptz,
  contact_id uuid,
  enrollment_id uuid,
  tracking_enabled boolean,
  tracking_route text,
  tracking_url text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    se.id,
    se.sent_at,
    se.subject,
    se.body,
    se.recipient_email,
    se.status,
    se.open_count,
    se.opened_at,
    se.contact_id,
    se.enrollment_id,
    se.tracking_enabled,
    se.tracking_route,
    se.tracking_url
  from public.sent_emails se
  join public.enrollments e on e.id = se.enrollment_id
  where e.sequence_id = p_sequence_id
  order by se.sent_at desc
  limit least(greatest(coalesce(p_limit, 5), 1), 20);
$$;

revoke all on function public.get_site_outreach_recent(uuid, integer) from public, anon;
grant execute on function public.get_site_outreach_recent(uuid, integer) to authenticated, service_role;
