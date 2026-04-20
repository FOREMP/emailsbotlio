
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppressed_emails_email_key
  ON public.suppressed_emails (lower(email));

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read suppressed_emails" ON public.suppressed_emails;
CREATE POLICY "Authenticated can read suppressed_emails"
  ON public.suppressed_emails FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies: only service-role (edge functions) can write.

-- Ensure do_not_contact has a unique constraint so upsert(onConflict) works
CREATE UNIQUE INDEX IF NOT EXISTS do_not_contact_user_email_key
  ON public.do_not_contact (user_id, lower(email));

-- Backfill: anyone who already clicked unsubscribe
INSERT INTO public.suppressed_emails (email, reason)
SELECT DISTINCT lower(email), 'unsubscribe'
FROM public.email_unsubscribe_tokens
WHERE used_at IS NOT NULL
ON CONFLICT DO NOTHING;
