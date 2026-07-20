ALTER TABLE public.generated_sites
  ADD COLUMN IF NOT EXISTS site_lead_id uuid REFERENCES public.site_leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_generated_sites_site_lead_id ON public.generated_sites(site_lead_id);
CREATE INDEX IF NOT EXISTS idx_site_leads_status_created ON public.site_leads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_site_leads_gen_link ON public.site_leads(generated_site_id) WHERE generated_site_id IS NOT NULL;

-- Schedule the orchestrator (audit + generate + reconcile)
SELECT cron.unschedule('process-site-leads') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='process-site-leads');

SELECT cron.schedule(
  'process-site-leads',
  '*/10 * * * *',
  $$
  select net.http_post(
    url:='https://eyliwidiljmzllsmytdh.supabase.co/functions/v1/process-site-leads',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bGl3aWRpbGptemxsc215dGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzYzMjQsImV4cCI6MjA4OTg1MjMyNH0.hDQxG3SKyOJ06g1IpOW5h-Ubi9zPSL2HjGc4zD2wX2Y"}'::jsonb,
    body:='{}'::jsonb
  )
  WHERE EXISTS (
    SELECT 1 FROM public.site_leads
    WHERE status IN ('pending_audit','needs_site','generating')
  );
  $$
);