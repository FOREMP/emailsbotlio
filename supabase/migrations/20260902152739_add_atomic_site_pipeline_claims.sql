-- Claim site-pipeline work atomically so overlapping cron/manual invocations
-- never audit or generate the same lead twice.

create index if not exists site_leads_pending_audit_language_created_idx
  on public.site_leads (language, created_at, id)
  where status = 'pending_audit' and website is not null;

create index if not exists site_leads_needs_site_language_priority_idx
  on public.site_leads (language, audit_score, created_at, id)
  where status = 'needs_site' and website is not null and email is not null;

create or replace function public.claim_site_leads_for_audit(
  p_language text,
  p_limit integer default 1
)
returns setof public.site_leads
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select sl.id
    from public.site_leads sl
    where sl.status = 'pending_audit'
      and sl.website is not null
      and coalesce(sl.language, 'sv') = case when p_language = 'en' then 'en' else 'sv' end
    order by sl.created_at asc, sl.id asc
    for update skip locked
    limit greatest(0, least(coalesce(p_limit, 1), 20))
  ), claimed as (
    update public.site_leads sl
    set status = 'auditing', updated_at = now()
    from candidates c
    where sl.id = c.id
    returning sl.*
  )
  select * from claimed;
$$;

create or replace function public.claim_site_leads_for_generation(
  p_language text,
  p_limit integer default 1
)
returns setof public.site_leads
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select sl.id
    from public.site_leads sl
    where sl.status = 'needs_site'
      and sl.website is not null
      and sl.email is not null
      and coalesce(sl.language, 'sv') = case when p_language = 'en' then 'en' else 'sv' end
    order by sl.audit_score asc nulls last, sl.created_at asc, sl.id asc
    for update skip locked
    limit greatest(0, least(coalesce(p_limit, 1), 20))
  ), claimed as (
    update public.site_leads sl
    set status = 'generating', generated_site_id = null, updated_at = now()
    from candidates c
    where sl.id = c.id
    returning sl.*
  )
  select * from claimed;
$$;

revoke all on function public.claim_site_leads_for_audit(text, integer) from public, anon, authenticated;
revoke all on function public.claim_site_leads_for_generation(text, integer) from public, anon, authenticated;
grant execute on function public.claim_site_leads_for_audit(text, integer) to service_role;
grant execute on function public.claim_site_leads_for_generation(text, integer) to service_role;

comment on function public.claim_site_leads_for_audit(text, integer)
  is 'Atomically claims pending website-audit leads for one language. Service role only.';
comment on function public.claim_site_leads_for_generation(text, integer)
  is 'Atomically claims needs-site leads for one language. Service role only.';
