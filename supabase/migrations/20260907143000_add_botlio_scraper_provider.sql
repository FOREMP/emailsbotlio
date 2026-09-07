-- Firecrawl remains the safe default. The self-hosted worker is enabled only
-- when the operator explicitly changes this setting in Site Leads.
insert into public.app_settings (key, value)
values ('site_scrape_provider', '{"provider":"firecrawl"}'::jsonb)
on conflict (key) do nothing;

alter table public.site_pipeline_error_events
  drop constraint if exists site_pipeline_error_events_provider_check;
alter table public.site_pipeline_error_events
  add constraint site_pipeline_error_events_provider_check
  check (provider in ('firecrawl', 'botlio_scraper', 'openrouter', 'vercel'));

alter table public.site_pipeline_breakers
  drop constraint if exists site_pipeline_breakers_provider_check;
alter table public.site_pipeline_breakers
  add constraint site_pipeline_breakers_provider_check
  check (provider in ('firecrawl', 'botlio_scraper', 'openrouter', 'vercel'));

insert into public.site_pipeline_breakers (provider)
values ('botlio_scraper')
on conflict (provider) do nothing;

create or replace function public.record_site_pipeline_failure(
  p_provider text,
  p_error_code text,
  p_error_message text,
  p_source_function text,
  p_http_status integer default null,
  p_site_lead_id uuid default null,
  p_generated_site_id uuid default null
)
returns table(error_count integer, is_paused boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_paused boolean;
  v_window_start timestamptz;
begin
  if p_provider not in ('firecrawl', 'botlio_scraper', 'openrouter', 'vercel') then
    raise exception 'unsupported pipeline provider';
  end if;

  perform pg_advisory_xact_lock(hashtext('site-pipeline:' || p_provider || ':' || p_error_code));

  insert into public.site_pipeline_error_events (
    provider, error_code, error_message, source_function, http_status,
    site_lead_id, generated_site_id
  ) values (
    p_provider,
    left(coalesce(nullif(p_error_code, ''), 'unknown_error'), 100),
    left(coalesce(nullif(p_error_message, ''), 'Unknown provider error'), 1000),
    left(coalesce(nullif(p_source_function, ''), 'unknown'), 100),
    p_http_status,
    p_site_lead_id,
    p_generated_site_id
  );

  select count(*)::integer, min(created_at)
    into v_count, v_window_start
  from public.site_pipeline_error_events
  where provider = p_provider
    and error_code = left(coalesce(nullif(p_error_code, ''), 'unknown_error'), 100)
    and created_at >= now() - interval '2 hours';

  v_paused := v_count >= 5;

  insert into public.site_pipeline_breakers (
    provider, is_paused, error_code, error_message, error_count,
    window_started_at, last_error_at, paused_at, updated_at
  ) values (
    p_provider, v_paused, left(coalesce(nullif(p_error_code, ''), 'unknown_error'), 100),
    left(coalesce(nullif(p_error_message, ''), 'Unknown provider error'), 1000),
    v_count, v_window_start, now(), case when v_paused then now() else null end, now()
  )
  on conflict (provider) do update set
    is_paused = public.site_pipeline_breakers.is_paused or excluded.is_paused,
    error_code = excluded.error_code,
    error_message = excluded.error_message,
    error_count = excluded.error_count,
    window_started_at = excluded.window_started_at,
    last_error_at = excluded.last_error_at,
    paused_at = case
      when public.site_pipeline_breakers.is_paused then public.site_pipeline_breakers.paused_at
      when excluded.is_paused then excluded.paused_at
      else public.site_pipeline_breakers.paused_at
    end,
    updated_at = now()
  returning public.site_pipeline_breakers.is_paused into v_paused;

  return query select v_count, v_paused;
end;
$$;

revoke all on function public.record_site_pipeline_failure(text,text,text,text,integer,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.record_site_pipeline_failure(text,text,text,text,integer,uuid,uuid)
  to service_role;
