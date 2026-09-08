-- `max_results = 0` is the explicit no-cap sentinel. The planner's stock and
-- backlog safeguards, rather than silent CSV truncation, control further work.

alter table public.lead_markets
  drop constraint if exists lead_markets_max_results_check;
alter table public.lead_markets
  alter column max_results set default 0;
alter table public.lead_markets
  add constraint lead_markets_max_results_check check (max_results >= 0);

alter table public.lead_scrape_jobs
  drop constraint if exists lead_scrape_jobs_max_results_check;
alter table public.lead_scrape_jobs
  add constraint lead_scrape_jobs_max_results_check check (max_results >= 0);

update public.lead_markets
set max_results = 0;

-- Queued jobs have not reached Lightsail yet, so they can safely inherit the
-- no-cap policy. Running jobs finish with the size already sent to the worker.
update public.lead_scrape_jobs
set max_results = 0
where state in ('queued', 'dispatched');
