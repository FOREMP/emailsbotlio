ALTER TABLE public.sent_emails
ADD COLUMN IF NOT EXISTS tracking_enabled boolean NOT NULL DEFAULT false;

-- Historic backfill:
-- 1) If we already recorded an open, the mail was definitely trackable.
-- 2) Before the 2026-08-19 tracking regression, follow-up threading/pixeling
--    was working in production, so old follow-ups are best treated as trackable.
-- 3) First-touch mails remain untracked by design.
WITH ranked AS (
  SELECT
    id,
    enrollment_id,
    sent_at,
    opened_at,
    open_count,
    row_number() OVER (
      PARTITION BY enrollment_id
      ORDER BY sent_at ASC, id ASC
    ) AS send_index
  FROM public.sent_emails
)
UPDATE public.sent_emails se
SET tracking_enabled = CASE
  WHEN COALESCE(r.open_count, 0) > 0 OR r.opened_at IS NOT NULL THEN true
  WHEN r.sent_at < TIMESTAMPTZ '2026-08-19 00:00:00+00' AND r.send_index > 1 THEN true
  ELSE false
END
FROM ranked r
WHERE se.id = r.id;
