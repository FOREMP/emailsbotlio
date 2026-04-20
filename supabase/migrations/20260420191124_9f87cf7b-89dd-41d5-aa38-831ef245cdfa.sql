UPDATE public.sending_domains
SET is_verified = true, updated_at = now()
WHERE domain IN ('botlio.email', 'botlio.eu', 'foremp.eu', 'foremp.one');

UPDATE public.sending_domains
SET is_verified = false, updated_at = now()
WHERE domain NOT IN ('botlio.email', 'botlio.eu', 'foremp.eu', 'foremp.one');