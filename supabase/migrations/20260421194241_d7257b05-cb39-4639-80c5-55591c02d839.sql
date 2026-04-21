ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_enrollments_status_next_send ON public.enrollments (status, next_send_at);
CREATE INDEX IF NOT EXISTS idx_contact_activity_seq_node_type_created ON public.contact_activity (sequence_id, node_id, activity_type, created_at);