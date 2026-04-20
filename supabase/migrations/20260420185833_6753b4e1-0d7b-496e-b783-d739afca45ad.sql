-- 1. Add is_verified to sending_domains
ALTER TABLE public.sending_domains ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
UPDATE public.sending_domains SET is_verified = true WHERE domain = 'foremp.one';

-- 2. Add deferred_at to enrollments
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS deferred_at timestamptz;

-- 3. Dedupe senders: keep oldest per (user_id, from_email)
DELETE FROM public.senders s
USING public.senders s2
WHERE s.user_id = s2.user_id
  AND s.from_email = s2.from_email
  AND s.created_at > s2.created_at;

-- 4. Prevent future duplicates
ALTER TABLE public.senders DROP CONSTRAINT IF EXISTS senders_user_id_from_email_key;
ALTER TABLE public.senders ADD CONSTRAINT senders_user_id_from_email_key UNIQUE (user_id, from_email);