
CREATE TABLE public.site_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  company_name_normalized TEXT NOT NULL,
  domain TEXT,
  domain_normalized TEXT,
  website TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  category TEXT,
  rating NUMERIC,
  reviews_count INTEGER,
  review_snippets JSONB,
  extra JSONB,
  demo_url TEXT,
  generated_site_id UUID REFERENCES public.generated_sites(id) ON DELETE SET NULL,
  audit_score INTEGER,
  audit_reason TEXT,
  audit_details JSONB,
  status TEXT NOT NULL DEFAULT 'pending_audit',
  feedback TEXT,
  source_file_id UUID,
  approved_at TIMESTAMPTZ,
  last_email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX site_leads_dedupe_idx
  ON public.site_leads (user_id, company_name_normalized, COALESCE(domain_normalized, ''));

CREATE INDEX site_leads_status_idx ON public.site_leads (user_id, status, created_at);
CREATE INDEX site_leads_generated_site_idx ON public.site_leads (generated_site_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_leads TO authenticated;
GRANT ALL ON public.site_leads TO service_role;

ALTER TABLE public.site_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own site_leads"
  ON public.site_leads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_site_leads_updated_at
  BEFORE UPDATE ON public.site_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
