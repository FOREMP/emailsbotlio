-- Rewind capacity-deferred enrollments back to their upstream schedule node
-- so they fire at the correct local time tomorrow instead of midnight UTC.
UPDATE enrollments e
SET current_node_id = sn.id,
    next_send_at = '2026-05-06 06:00:00+00'  -- 08:00 Stockholm-ish; schedule node will recompute exactly
FROM sequence_nodes sn
WHERE e.status = 'waiting_capacity'
  AND sn.sequence_id = e.sequence_id
  AND sn.node_type = 'schedule';