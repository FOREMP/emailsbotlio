alter table public.site_leads
  add column if not exists call_status text not null default 'not_called',
  add column if not exists call_note text,
  add column if not exists called_at timestamptz;

alter table public.site_leads
  drop constraint if exists site_leads_call_status_check;

alter table public.site_leads
  add constraint site_leads_call_status_check
  check (call_status in (
    'not_called',
    'called',
    'no_answer',
    'not_interested',
    'follow_up',
    'interested',
    'converted'
  ));

drop function if exists public.get_call_lead_queue(text, integer, boolean, integer, integer);

create or replace function public.get_call_lead_queue(
  p_language text default null,
  p_min_opens integer default 3,
  p_only_uncalled boolean default true,
  p_since timestamptz default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  lead_id uuid,
  company_name text,
  language text,
  email text,
  phone text,
  website text,
  demo_url text,
  lead_status text,
  call_status text,
  call_note text,
  called_at timestamptz,
  total_opens integer,
  max_single_email_opens integer,
  opened_email_count integer,
  sent_email_count integer,
  last_opened_at timestamptz,
  last_sent_at timestamptz,
  latest_subject text,
  has_reply boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with email_interest as materialized (
    select
      se.user_id,
      se.recipient_email,
      sum(greatest(
        coalesce(se.open_count, 0),
        case when se.opened_at is not null then 1 else 0 end
      ))::integer as total_opens,
      max(greatest(
        coalesce(se.open_count, 0),
        case when se.opened_at is not null then 1 else 0 end
      ))::integer as max_single_email_opens,
      count(*) filter (
        where coalesce(se.open_count, 0) > 0 or se.opened_at is not null
      )::integer as opened_email_count,
      count(*)::integer as sent_email_count,
      max(coalesce(se.last_opened_at, se.opened_at)) as last_opened_at,
      max(se.sent_at) as last_sent_at,
      (array_agg(se.subject order by se.sent_at desc))[1] as latest_subject,
      bool_or(se.replied_at is not null) as has_reply
    from public.sent_emails se
    where se.user_id = (select auth.uid())
      and se.recipient_email is not null
      and se.status in ('sent', 'bounced', 'complained', 'unsubscribed')
      and (p_since is null or coalesce(se.last_opened_at, se.opened_at) >= p_since)
    group by se.user_id, se.recipient_email
    having max(greatest(
      coalesce(se.open_count, 0),
      case when se.opened_at is not null then 1 else 0 end
    )) >= greatest(coalesce(p_min_opens, 1), 1)
  ), candidates as (
    select
      sl.id as lead_id,
      sl.company_name,
      sl.language,
      sl.email,
      sl.phone,
      sl.website,
      sl.demo_url,
      sl.status as lead_status,
      sl.call_status,
      sl.call_note,
      sl.called_at,
      ei.total_opens,
      ei.max_single_email_opens,
      ei.opened_email_count,
      ei.sent_email_count,
      ei.last_opened_at,
      ei.last_sent_at,
      ei.latest_subject,
      ei.has_reply
    from public.site_leads sl
    join email_interest ei
      on ei.user_id = sl.user_id
     and ei.recipient_email = sl.email
    where sl.user_id = (select auth.uid())
      and nullif(trim(sl.phone), '') is not null
      and sl.status <> 'unsubscribed'
      and (p_language is null or sl.language = p_language)
      and (not coalesce(p_only_uncalled, true) or sl.call_status = 'not_called')
  )
  select
    c.*,
    count(*) over() as total_count
  from candidates c
  order by
    c.has_reply desc,
    c.max_single_email_opens desc,
    c.total_opens desc,
    c.last_opened_at desc nulls last,
    c.lead_id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_call_lead_queue(text, integer, boolean, timestamptz, integer, integer) from public;
grant execute on function public.get_call_lead_queue(text, integer, boolean, timestamptz, integer, integer) to authenticated;
