ALTER TABLE public.sending_domains ADD COLUMN IF NOT EXISTS tracking_host text;
GRANT SELECT, INSERT, UPDATE ON public.sending_domains TO authenticated;
GRANT ALL ON public.sending_domains TO service_role;