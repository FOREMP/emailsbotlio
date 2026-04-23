ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS assigned_sender_id uuid;

-- Backfill: for each enrollment that already has sent emails, pick the earliest sender used
UPDATE public.enrollments e
SET assigned_sender_id = se.sender_id
FROM (
  SELECT DISTINCT ON (enrollment_id) enrollment_id, sender_id
  FROM public.sent_emails
  WHERE enrollment_id IS NOT NULL AND sender_id IS NOT NULL
  ORDER BY enrollment_id, sent_at ASC
) se
WHERE se.enrollment_id = e.id
  AND e.assigned_sender_id IS NULL;