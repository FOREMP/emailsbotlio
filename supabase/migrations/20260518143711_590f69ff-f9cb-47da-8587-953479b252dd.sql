ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS open_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;
CREATE INDEX IF NOT EXISTS sent_emails_message_id_idx ON public.sent_emails(message_id);