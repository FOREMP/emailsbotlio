-- Durable, operator-controlled Google Maps sourcing. These tables are additive:
-- manual CSV imports and the existing audit/generation pipeline keep working.

create table if not exists public.lead_markets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('sv', 'en')),
  country_code text not null check (char_length(country_code) = 2),
  city text not null,
  category text not null,
  search_query text not null,
  is_enabled boolean not null default true,
  priority integer not null default 100 check (priority between 1 and 1000),
  max_results integer not null default 75 check (max_results between 1 and 150),
  cooldown_days integer not null default 21 check (cooldown_days between 1 and 90),
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, language, country_code, city, search_query)
);

create table if not exists public.lead_scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  market_id uuid not null references public.lead_markets(id) on delete restrict,
  language text not null check (language in ('sv', 'en')),
  search_query text not null,
  state text not null default 'queued' check (state in ('queued', 'dispatched', 'running', 'importing', 'completed', 'failed', 'cancelled')),
  max_results integer not null check (max_results between 1 and 150),
  worker_job_id text unique,
  discovered_count integer not null default 0,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  rejected_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_scrape_one_active_market_idx
  on public.lead_scrape_jobs (market_id)
  where state in ('queued', 'dispatched', 'running', 'importing');
create index if not exists lead_scrape_jobs_user_state_created_idx
  on public.lead_scrape_jobs (user_id, state, created_at desc);
create index if not exists lead_markets_user_language_enabled_idx
  on public.lead_markets (user_id, language, is_enabled, priority, last_scraped_at);

create table if not exists public.lead_scrape_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.lead_scrape_jobs(id) on delete cascade,
  place_id text,
  company_name text,
  website text,
  email text,
  outcome text not null check (outcome in ('imported', 'duplicate', 'rejected', 'failed')),
  rejection_reason text,
  site_lead_id uuid references public.site_leads(id) on delete set null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists lead_scrape_results_job_place_idx
  on public.lead_scrape_results (job_id, place_id)
  where place_id is not null;
create index if not exists lead_scrape_results_job_idx on public.lead_scrape_results(job_id, created_at);

alter table public.site_leads
  add column if not exists source_provider text,
  add column if not exists source_place_id text,
  add column if not exists source_job_id uuid references public.lead_scrape_jobs(id) on delete set null,
  add column if not exists source_market_id uuid references public.lead_markets(id) on delete set null;

create unique index if not exists site_leads_source_place_dedupe_idx
  on public.site_leads (user_id, source_provider, source_place_id)
  where source_provider is not null and source_place_id is not null;
create index if not exists site_leads_source_job_idx on public.site_leads(source_job_id) where source_job_id is not null;

alter table public.lead_markets enable row level security;
alter table public.lead_scrape_jobs enable row level security;
alter table public.lead_scrape_results enable row level security;

grant select, insert, update, delete on public.lead_markets to authenticated;
grant select, insert, update, delete on public.lead_scrape_jobs to authenticated;
grant select on public.lead_scrape_results to authenticated;
grant all on public.lead_markets, public.lead_scrape_jobs, public.lead_scrape_results to service_role;

create policy "Users manage own lead markets" on public.lead_markets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users read own lead scrape jobs" on public.lead_scrape_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create own lead scrape jobs" on public.lead_scrape_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own lead scrape jobs" on public.lead_scrape_jobs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users read own lead scrape results" on public.lead_scrape_results
  for select to authenticated
  using (exists (
    select 1 from public.lead_scrape_jobs j
    where j.id = lead_scrape_results.job_id and j.user_id = (select auth.uid())
  ));

drop trigger if exists update_lead_markets_updated_at on public.lead_markets;
create trigger update_lead_markets_updated_at before update on public.lead_markets
  for each row execute function public.update_updated_at_column();
drop trigger if exists update_lead_scrape_jobs_updated_at on public.lead_scrape_jobs;
create trigger update_lead_scrape_jobs_updated_at before update on public.lead_scrape_jobs
  for each row execute function public.update_updated_at_column();

insert into public.app_settings(key, value)
values ('lead_sourcing_state', '{"state":"manual","buffer_days":3,"max_auto_jobs_per_language_per_day":1}'::jsonb)
on conflict (key) do nothing;
