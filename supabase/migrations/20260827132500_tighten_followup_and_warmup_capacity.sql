CREATE OR REPLACE FUNCTION public.sender_capacity_remaining(_sender_id uuid, _is_followup boolean)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  base_quota integer;
  followup_quota integer;
  mult integer;
  warmup_enabled_flag boolean;
  warmup_started_flag boolean;
  first_used integer;
  followup_used integer;
  stockholm_day_start timestamptz;
BEGIN
  base_quota := public.sender_warmup_quota(_sender_id);

  SELECT
    COALESCE(followup_multiplier, 3),
    COALESCE(warmup_enabled, false),
    (warmup_started_at IS NOT NULL)
  INTO mult, warmup_enabled_flag, warmup_started_flag
  FROM public.senders
  WHERE id = _sender_id;

  IF mult IS NULL THEN mult := 3; END IF;

  IF warmup_enabled_flag AND warmup_started_flag THEN
    followup_quota := LEAST(base_quota * mult, GREATEST(3, CEIL(base_quota::numeric * 0.5))::integer);
  ELSE
    followup_quota := base_quota * mult;
  END IF;

  stockholm_day_start := date_trunc('day', timezone('Europe/Stockholm', now())) AT TIME ZONE 'Europe/Stockholm';

  WITH today AS (
    SELECT
      se.id,
      se.enrollment_id,
      (
        se.enrollment_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.sent_emails p
          WHERE p.enrollment_id = se.enrollment_id
            AND p.status IN ('sent','queued')
            AND p.sent_at < se.sent_at
        )
      ) AS is_followup
    FROM public.sent_emails se
    WHERE se.sender_id = _sender_id
      AND se.status IN ('sent','queued')
      AND se.sent_at >= stockholm_day_start
  )
  SELECT
    COUNT(*) FILTER (WHERE NOT is_followup)::int,
    COUNT(*) FILTER (WHERE is_followup)::int
  INTO first_used, followup_used
  FROM today;

  IF _is_followup THEN
    RETURN GREATEST(0, followup_quota - COALESCE(followup_used, 0));
  END IF;

  RETURN GREATEST(0, base_quota - COALESCE(first_used, 0));
END;
$function$;
