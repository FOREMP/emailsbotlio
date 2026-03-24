
-- Create simulation status enum
CREATE TYPE public.simulation_status AS ENUM (
  'draft', 'processing_materials', 'generating_agents', 'running', 'completed', 'failed'
);

-- Create seed material type enum
CREATE TYPE public.seed_material_type AS ENUM ('pdf', 'image', 'text');

-- Simulations table
CREATE TABLE public.simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  question TEXT,
  status simulation_status NOT NULL DEFAULT 'draft',
  agent_count INTEGER NOT NULL DEFAULT 2000,
  agents_processed INTEGER NOT NULL DEFAULT 0,
  context_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own simulations" ON public.simulations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own simulations" ON public.simulations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own simulations" ON public.simulations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own simulations" ON public.simulations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Seed materials table
CREATE TABLE public.seed_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID REFERENCES public.simulations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type seed_material_type NOT NULL,
  content TEXT,
  file_path TEXT,
  file_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.seed_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own seed materials" ON public.seed_materials
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own seed materials" ON public.seed_materials
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own seed materials" ON public.seed_materials
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Agents table
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID REFERENCES public.simulations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  persona JSONB NOT NULL DEFAULT '{}',
  response TEXT,
  sentiment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agents of own simulations" ON public.agents
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.simulations s WHERE s.id = simulation_id AND s.user_id = auth.uid()));
CREATE POLICY "Service role can insert agents" ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.simulations s WHERE s.id = simulation_id AND s.user_id = auth.uid()));

-- Reports table
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID REFERENCES public.simulations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  summary TEXT,
  full_report TEXT,
  insights JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports" ON public.reports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reports" ON public.reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Storage bucket for seed materials
INSERT INTO storage.buckets (id, name, public) VALUES ('seed-materials', 'seed-materials', false);

-- Storage RLS policies
CREATE POLICY "Users can upload own files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'seed-materials' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can view own files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'seed-materials' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'seed-materials' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Enable realtime for simulations
ALTER PUBLICATION supabase_realtime ADD TABLE public.simulations;
