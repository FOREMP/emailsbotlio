ALTER TABLE public.site_leads ADD COLUMN IF NOT EXISTS niche text NOT NULL DEFAULT 'auto_workshop';
CREATE INDEX IF NOT EXISTS idx_site_leads_niche ON public.site_leads(niche);