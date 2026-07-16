alter table public.generated_sites
  add column if not exists attempts int not null default 0,
  add column if not exists queued_at timestamptz;

create index if not exists generated_sites_status_queued_idx
  on public.generated_sites (status, queued_at)
  where status in ('queued','processing');