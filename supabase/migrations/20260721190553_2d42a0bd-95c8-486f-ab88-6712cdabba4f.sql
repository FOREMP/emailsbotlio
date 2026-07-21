CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read app_settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write app_settings" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.app_settings(key, value) VALUES ('site_generation_state', '{"state":"running"}'::jsonb)
  ON CONFLICT (key) DO NOTHING;