UPDATE sequence_nodes n
SET config = jsonb_set(
  config,
  '{prompt}',
  to_jsonb(replace(replace(config->>'prompt', 'SEK 5,000', '£500'), 'SEK 1,000', '£100'))
)
FROM sequences s
WHERE s.id = n.sequence_id
  AND s.name ILIKE '%Site Demo Outreach EN%'
  AND n.node_type = 'send_email'
  AND (config->>'prompt' LIKE '%SEK 5,000%' OR config->>'prompt' LIKE '%SEK 1,000%');