
-- 1. sending_domains table
CREATE TABLE public.sending_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  brand text NOT NULL CHECK (brand IN ('foremp','botlio')),
  reply_to_email text NOT NULL,
  sender_subdomain text NOT NULL DEFAULT 'notify',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sending_domains ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user (it's a shared registry, not user-scoped)
CREATE POLICY "Authenticated can read sending_domains"
  ON public.sending_domains FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_sending_domains_updated_at
  BEFORE UPDATE ON public.sending_domains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed the 6 known domains
INSERT INTO public.sending_domains (domain, brand, reply_to_email) VALUES
  ('foremp.one',   'foremp', 'eric@foremp.se'),
  ('foremp.eu',    'foremp', 'eric@foremp.se'),
  ('foremp.email', 'foremp', 'eric@foremp.se'),
  ('botlio.io',    'botlio', 'eric@botlio.io'),
  ('botlio.eu',    'botlio', 'eric@botlio.io'),
  ('botlio.email', 'botlio', 'eric@botlio.io')
ON CONFLICT (domain) DO NOTHING;

-- 2. Helper RPC: seed default senders (Eric + Isak per active domain) for the calling user.
-- We can't seed senders globally because senders.user_id is per-user. The Senders page calls this on load.
CREATE OR REPLACE FUNCTION public.seed_default_senders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  d record;
  inserted integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  FOR d IN SELECT domain, reply_to_email FROM public.sending_domains WHERE is_active = true LOOP
    -- Eric
    INSERT INTO public.senders (user_id, from_name, from_email, reply_to, is_active)
    SELECT uid, 'Eric Wahlbom', 'eric@' || d.domain, d.reply_to_email, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.senders
      WHERE user_id = uid AND from_email = 'eric@' || d.domain
    );
    GET DIAGNOSTICS inserted = ROW_COUNT;

    -- Isak
    INSERT INTO public.senders (user_id, from_name, from_email, reply_to, is_active)
    SELECT uid, 'Isak Andersson', 'isak@' || d.domain, d.reply_to_email, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.senders
      WHERE user_id = uid AND from_email = 'isak@' || d.domain
    );
  END LOOP;

  RETURN 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_senders() TO authenticated;
