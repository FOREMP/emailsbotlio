-- Set schedule node to 18:00 Stockholm
UPDATE public.sequence_nodes
SET config = jsonb_set(config, '{time_of_day}', '"18:00"')
WHERE id = 'ba6d8a4d-ed42-42ed-aa7a-7d2a0696b998';

-- Reset the 3 enrollments back to the schedule node, fresh state
UPDATE public.enrollments
SET status = 'active',
    current_node_id = 'ba6d8a4d-ed42-42ed-aa7a-7d2a0696b998',
    next_send_at = now(),
    last_sent_at = NULL,
    attempt_count = 0,
    last_error = NULL,
    error_at = NULL,
    deferred_at = NULL
WHERE sequence_id = '16296d69-40a7-49b6-bfea-eebc9b18e18c'
  AND id IN (
    '8361e7ca-6085-490f-8388-c35e1de342d9',
    'b6e18ede-4baa-4e01-a545-38292ea51df9',
    'a4c61bec-2e99-48ac-ab66-19f67d6c901f'
  );