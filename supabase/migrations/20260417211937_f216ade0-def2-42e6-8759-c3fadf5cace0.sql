
-- senders
CREATE TABLE public.senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  reply_to TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own senders" ON public.senders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_senders_updated BEFORE UPDATE ON public.senders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sequences
CREATE TABLE public.sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  contact_list_id UUID,
  status TEXT NOT NULL DEFAULT 'draft',
  sender_rotation JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sequences" ON public.sequences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_sequences_updated BEFORE UPDATE ON public.sequences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sequence_steps
CREATE TABLE public.sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  sequence_id UUID NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT,
  ai_prompt TEXT,
  ai_model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash',
  use_ai BOOLEAN NOT NULL DEFAULT true,
  body_template TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_order)
);
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own steps" ON public.sequence_steps FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_steps_updated BEFORE UPDATE ON public.sequence_steps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- enrollments
CREATE TABLE public.enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  sequence_id UUID NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  next_send_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id)
);
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own enrollments" ON public.enrollments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_enrollments_updated BEFORE UPDATE ON public.enrollments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_enrollments_due ON public.enrollments (next_send_at) WHERE status = 'active';

-- sent_emails
CREATE TABLE public.sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  enrollment_id UUID REFERENCES public.enrollments(id) ON DELETE SET NULL,
  step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  sender_id UUID REFERENCES public.senders(id) ON DELETE SET NULL,
  contact_id UUID,
  recipient_email TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error_message TEXT
);
ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sent_emails" ON public.sent_emails FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sent_emails_user_sent ON public.sent_emails (user_id, sent_at DESC);

-- do_not_contact
CREATE TABLE public.do_not_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, email)
);
ALTER TABLE public.do_not_contact ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own DNC" ON public.do_not_contact FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
