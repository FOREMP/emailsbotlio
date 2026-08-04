ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS followup_multiplier integer NOT NULL DEFAULT 3;

CREATE OR REPLACE FUNCTION public.sender_capacity_remaining(_sender_id uuid, _is_followup boolean)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  base_quota integer;
  mult integer;
  first_used integer;
  followup_used integer;
BEGIN
  base_quota := public.sender_warmup_quota(_sender_id);
  SELECT COALESCE(followup_multiplier, 3) INTO mult FROM public.senders WHERE id = _sender_id;
  IF mult IS NULL THEN mult := 3; END IF;

  WITH today AS (
    SELECT se.id, se.enrollment_id,
           (se.enrollment_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.sent_emails p
              WHERE p.enrollment_id = se.enrollment_id
                AND p.status IN ('sent','queued')
                AND p.sent_at < se.sent_at
           )) AS is_followup
    FROM public.sent_emails se
    WHERE se.sender_id = _sender_id
      AND se.status IN ('sent','queued')
      AND se.sent_at >= date_trunc('day', now())
  )
  SELECT COUNT(*) FILTER (WHERE NOT is_followup)::int,
         COUNT(*) FILTER (WHERE is_followup)::int
    INTO first_used, followup_used
  FROM today;

  IF _is_followup THEN
    RETURN GREATEST(0, (base_quota * mult) - COALESCE(followup_used, 0));
  END IF;
  RETURN GREATEST(0, base_quota - COALESCE(first_used, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.sender_daily_remaining(_sender_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.sender_capacity_remaining(_sender_id, false);
$function$;