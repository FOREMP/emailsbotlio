
-- Deactivate botlio.io domain + its senders
UPDATE public.sending_domains SET is_active = false WHERE domain = 'botlio.io';
UPDATE public.senders SET is_active = false WHERE from_email LIKE '%@botlio.io';

-- Mark foremp.email as verified (confirmed via Lovable email status check)
UPDATE public.sending_domains SET is_verified = true WHERE domain = 'foremp.email';

-- For foremp.email senders, keep one row per address active with daily_limit=5; deactivate duplicates
UPDATE public.senders SET is_active = false WHERE id = 'a45752ae-9b6e-46f6-8b31-6b25c5133200';
UPDATE public.senders SET is_active = false WHERE id = 'db3a7c10-ea8f-4439-9d3a-4a19a689c74a';
UPDATE public.senders SET daily_limit = 5, is_active = true WHERE id = 'daba5d79-62c9-49f1-808e-70b2a5501f38';
UPDATE public.senders SET daily_limit = 5, is_active = true WHERE id = '6ddd4f1c-2016-4de7-a3f1-e4de77ac12dd';
