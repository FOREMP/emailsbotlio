ALTER TABLE public.sending_domains ADD COLUMN IF NOT EXISTS postal_address text;

CREATE TABLE IF NOT EXISTS public.gdpr_erasures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_hash text NOT NULL,
  reason text,
  erased_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gdpr_erasures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gdpr erasures"
  ON public.gdpr_erasures FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own gdpr erasures"
  ON public.gdpr_erasures FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_gdpr_erasures_user ON public.gdpr_erasures(user_id, erased_at DESC);