
-- 1) Unsubscribe tokens table required by Lovable email API
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  token text NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role reads/writes; no public policies (table is admin-only)
CREATE POLICY "no public access to unsubscribe tokens"
ON public.email_unsubscribe_tokens FOR SELECT USING (false);

-- 2) Clean up duplicated seeded nodes/edges and reset broken completed enrollments
-- for the current sequence so the user can re-test cleanly.
DELETE FROM public.sequence_edges WHERE sequence_id = 'db389fac-fe03-42f6-abae-a14506bac39d';
DELETE FROM public.sequence_nodes WHERE sequence_id = 'db389fac-fe03-42f6-abae-a14506bac39d';
DELETE FROM public.enrollments    WHERE sequence_id = 'db389fac-fe03-42f6-abae-a14506bac39d';
