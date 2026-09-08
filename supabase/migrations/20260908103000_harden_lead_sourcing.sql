-- These indexes cover the two foreign keys introduced for lead sourcing.
-- They keep future market/job drill-downs and cleanup operations inexpensive.
create index if not exists lead_scrape_results_site_lead_id_idx
  on public.lead_scrape_results(site_lead_id)
  where site_lead_id is not null;

create index if not exists site_leads_source_market_id_idx
  on public.site_leads(source_market_id)
  where source_market_id is not null;
