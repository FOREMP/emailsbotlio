-- Places and niches remain operator-controlled, while lead_markets continues
-- to be the durable, one-combination-at-a-time queue consumed by the worker.

alter table public.lead_markets
  add column if not exists niche_key text;

update public.lead_markets
set niche_key = case
  when lower(coalesce(category, '')) like '%hair%' or lower(coalesce(search_query, '')) like '%frisör%' then 'hair_salon'
  else null
end
where niche_key is null;

create index if not exists lead_markets_user_locale_niche_idx
  on public.lead_markets(user_id, language, country_code, city, niche_key);

create table if not exists public.lead_scrape_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null check (language in ('sv', 'en')),
  city_key text not null,
  niche_key text not null,
  city text not null,
  search_query text,
  source text not null check (source in ('legacy_local', 'server')),
  source_note text,
  market_id uuid references public.lead_markets(id) on delete set null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, language, city_key, niche_key)
);

create index if not exists lead_scrape_history_user_lookup_idx
  on public.lead_scrape_history(user_id, language, city_key, niche_key);

alter table public.lead_scrape_history enable row level security;
grant select on public.lead_scrape_history to authenticated;
grant all on public.lead_scrape_history to service_role;
create policy "Users read own lead scrape history" on public.lead_scrape_history
  for select to authenticated
  using ((select auth.uid()) = user_id);
