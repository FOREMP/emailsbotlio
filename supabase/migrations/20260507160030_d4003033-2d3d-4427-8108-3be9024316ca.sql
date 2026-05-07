ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS bounced_at timestamptz,
  ADD COLUMN IF NOT EXISTS complained_at timestamptz,
  ADD COLUMN IF NOT EXISTS bounce_type text;

CREATE INDEX IF NOT EXISTS idx_sent_emails_message_id ON public.sent_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_recipient ON public.sent_emails(recipient_email);