ALTER TABLE public.generated_sites
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'template',
  ADD COLUMN IF NOT EXISTS gen_progress jsonb;