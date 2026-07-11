
-- Site Generator MVP — Phase 1 schema

-- 1) generated_sites tracking table
CREATE TABLE public.generated_sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  sequence_id UUID REFERENCES public.sequences(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending | auditing | audited | scraping | scraped | generating | deploying | live | failed | skipped
  template TEXT NOT NULL DEFAULT 'auto_workshop_v1',
  source_url TEXT,
  audit_score INT,
  audit_reason TEXT,
  scraped_content JSONB,
  generated_files JSONB,
  github_repo_url TEXT,
  vercel_project_id TEXT,
  vercel_deployment_url TEXT,
  demo_site_url TEXT,
  cost_credits NUMERIC(10,4) DEFAULT 0,
  error_message TEXT,
  click_count INT NOT NULL DEFAULT 0,
  last_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_sites TO authenticated;
GRANT ALL ON public.generated_sites TO service_role;

ALTER TABLE public.generated_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own generated sites"
  ON public.generated_sites
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_generated_sites_user ON public.generated_sites(user_id);
CREATE INDEX idx_generated_sites_contact ON public.generated_sites(contact_id);
CREATE INDEX idx_generated_sites_status ON public.generated_sites(status);

CREATE TRIGGER trg_generated_sites_updated_at
  BEFORE UPDATE ON public.generated_sites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) contacts.demo_site_url for mail merge {{demo_site_url}}
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS demo_site_url TEXT;
