-- Add daily limit + warmup fields to senders
ALTER TABLE public.senders
  ADD COLUMN IF NOT EXISTS daily_limit integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS warmup_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warmup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_target integer NOT NULL DEFAULT 50;

-- Helper: today's allowed quota for a sender
-- Standard cold-email warmup curve: day1=5, +5/day until 30, then +10/day to target
CREATE OR REPLACE FUNCTION public.sender_warmup_quota(_sender_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  day_num integer;
  ramp integer;
BEGIN
  SELECT daily_limit, warmup_enabled, warmup_started_at, warmup_target
    INTO s FROM public.senders WHERE id = _sender_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT s.warmup_enabled OR s.warmup_started_at IS NULL THEN
    RETURN s.daily_limit;
  END IF;
  day_num := GREATEST(1, (EXTRACT(EPOCH FROM (now() - s.warmup_started_at)) / 86400)::int + 1);
  IF day_num <= 6 THEN
    ramp := day_num * 5;            -- 5,10,15,20,25,30
  ELSE
    ramp := 30 + (day_num - 6) * 10; -- 40,50,60,...
  END IF;
  RETURN LEAST(s.daily_limit, s.warmup_target, GREATEST(5, ramp));
END;
$$;

-- Helper: how many emails this sender may still send today
CREATE OR REPLACE FUNCTION public.sender_daily_remaining(_sender_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  quota integer;
  used integer;
BEGIN
  quota := public.sender_warmup_quota(_sender_id);
  SELECT COUNT(*)::int INTO used FROM public.sent_emails
    WHERE sender_id = _sender_id
      AND status IN ('sent','queued')
      AND sent_at >= date_trunc('day', now());
  RETURN GREATEST(0, quota - COALESCE(used,0));
END;
$$;