
UPDATE public.sequence_nodes
SET config = jsonb_set(config, '{days}', '["Sun","Mon","Tue","Wed","Thu","Fri"]'::jsonb),
    updated_at = now()
WHERE id = 'ba6d8a4d-ed42-42ed-aa7a-7d2a0696b998';

UPDATE public.enrollments
SET next_send_at = now(),
    updated_at = now()
WHERE id = 'a4c61bec-2e99-48ac-ab66-19f67d6c901f';
