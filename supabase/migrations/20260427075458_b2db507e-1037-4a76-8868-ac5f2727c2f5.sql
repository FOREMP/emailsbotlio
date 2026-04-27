UPDATE public.sequence_nodes
SET config = jsonb_set(config, '{time_of_day}', '"10:00"'::jsonb)
WHERE id = 'c00f7484-b952-46a5-808b-e01595ef770e';

UPDATE public.enrollments
SET status = 'active',
    current_node_id = 'c00f7484-b952-46a5-808b-e01595ef770e',
    next_send_at = now(),
    last_sent_at = NULL,
    attempt_count = 0,
    deferred_at = NULL,
    last_error = NULL,
    error_at = NULL,
    assigned_sender_id = NULL
WHERE sequence_id = '40e30a8c-e3e9-4371-865e-604952c483b1'
  AND status = 'failed'
  AND current_node_id IS NULL;