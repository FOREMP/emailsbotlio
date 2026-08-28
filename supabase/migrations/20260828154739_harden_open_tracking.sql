ALTER TABLE public.sending_domains
  ADD COLUMN IF NOT EXISTS tracking_host_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_host_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_host_last_error text;

ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS tracking_url text,
  ADD COLUMN IF NOT EXISTS tracking_route text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sent_emails_tracking_route_check'
      AND conrelid = 'public.sent_emails'::regclass
  ) THEN
    ALTER TABLE public.sent_emails
      ADD CONSTRAINT sent_emails_tracking_route_check
      CHECK (tracking_route IN ('none', 'custom', 'supabase'));
  END IF;
END
$$;

-- A configured host is not safe until a public GIF request succeeds. Reset the
-- old Vercel-only verification state so new follow-ups immediately use the
-- working Supabase endpoint until the health checker proves a custom host.
UPDATE public.sending_domains
SET tracking_host = NULL,
    tracking_host_verified_at = NULL,
    tracking_host_last_checked_at = now(),
    tracking_host_last_error = 'Awaiting public pixel health check'
WHERE tracking_host IS NOT NULL;

-- Tracking hosts are operational configuration. Signed-in browser users may
-- inspect status, but only service-side functions should change it.
DROP POLICY IF EXISTS "Authenticated can update sending_domains" ON public.sending_domains;

CREATE INDEX IF NOT EXISTS idx_sending_domains_tracking_health
  ON public.sending_domains (is_active, is_verified, tracking_host_verified_at);

CREATE OR REPLACE FUNCTION public.record_email_open(p_message_id text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  contact_id uuid,
  enrollment_id uuid,
  is_first boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH target AS (
    SELECT se.id, (se.opened_at IS NULL) AS is_first
    FROM public.sent_emails AS se
    WHERE se.message_id = p_message_id
    FOR UPDATE
  ), updated AS (
    UPDATE public.sent_emails AS se
    SET opened_at = COALESCE(se.opened_at, now()),
        last_opened_at = now(),
        open_count = COALESCE(se.open_count, 0) + 1
    FROM target
    WHERE se.id = target.id
    RETURNING se.id, se.user_id, se.contact_id, se.enrollment_id, target.is_first
  )
  SELECT * FROM updated;
$$;

REVOKE ALL ON FUNCTION public.record_email_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_open(text) TO service_role;

