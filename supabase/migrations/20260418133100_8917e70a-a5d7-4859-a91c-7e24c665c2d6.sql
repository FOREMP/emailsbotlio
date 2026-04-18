CREATE UNIQUE INDEX IF NOT EXISTS enrollments_sequence_contact_unique
ON public.enrollments (sequence_id, contact_id);