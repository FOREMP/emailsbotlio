UPDATE public.enrollments
SET
  status = 'active',
  current_step = 0,
  current_node_id = 'ba6d8a4d-ed42-42ed-aa7a-7d2a0696b998',
  next_send_at = now(),
  last_sent_at = NULL,
  assigned_sender_id = NULL,
  attempt_count = 0,
  deferred_at = NULL,
  last_error = NULL,
  error_at = NULL,
  updated_at = now()
WHERE id = 'a4c61bec-2e99-48ac-ab66-19f67d6c901f'
  AND sequence_id = '16296d69-40a7-49b6-bfea-eebc9b18e18c'
  AND status = 'failed';