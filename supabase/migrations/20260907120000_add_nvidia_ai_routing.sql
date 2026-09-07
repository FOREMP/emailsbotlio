-- Dashboard-selected AI provider. Secrets remain in Edge Function secrets;
-- this row stores only the non-sensitive provider preference.
INSERT INTO public.app_settings (key, value)
VALUES ('ai_primary_provider', '{"provider":"openrouter"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.nvidia_api_rate_slots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS nvidia_api_rate_slots_requested_at_idx
  ON private.nvidia_api_rate_slots(requested_at);

REVOKE ALL ON private.nvidia_api_rate_slots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.nvidia_api_rate_slots TO service_role;

-- Atomically reserve one NVIDIA request in the rolling 60-second window. Returning
-- zero means the caller owns a slot; a positive value is how long it must wait.
CREATE OR REPLACE FUNCTION public.claim_nvidia_api_slot(p_limit integer DEFAULT 40)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
DECLARE
  v_count integer;
  v_oldest timestamptz;
  v_wait_ms integer;
BEGIN
  p_limit := LEAST(40, GREATEST(1, COALESCE(p_limit, 40)));

  -- Serialize claims so concurrent Edge isolates cannot all observe the same
  -- remaining capacity. This enforces a true rolling 60-second window, not a
  -- calendar-minute window that could allow 80 calls around :59/:00.
  PERFORM pg_advisory_xact_lock(hashtext('botlio:nvidia-api-rate-limit'));

  DELETE FROM private.nvidia_api_rate_slots
  WHERE requested_at < clock_timestamp() - interval '2 hours';

  SELECT count(*)::integer, min(requested_at)
    INTO v_count, v_oldest
  FROM private.nvidia_api_rate_slots
  WHERE requested_at > clock_timestamp() - interval '60 seconds';

  IF v_count < p_limit THEN
    INSERT INTO private.nvidia_api_rate_slots DEFAULT VALUES;
    RETURN 0;
  END IF;

  v_wait_ms := CEIL(EXTRACT(EPOCH FROM ((v_oldest + interval '60 seconds') - clock_timestamp())) * 1000);
  RETURN GREATEST(100, v_wait_ms);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_nvidia_api_slot(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_nvidia_api_slot(integer) TO service_role;
