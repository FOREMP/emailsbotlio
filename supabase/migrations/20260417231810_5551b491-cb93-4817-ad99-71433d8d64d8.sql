
-- sequence_nodes
CREATE TABLE public.sequence_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id UUID NOT NULL,
  user_id UUID NOT NULL,
  node_type TEXT NOT NULL,
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sequence_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sequence_nodes" ON public.sequence_nodes
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sequence_nodes_sequence ON public.sequence_nodes(sequence_id);
CREATE TRIGGER update_sequence_nodes_updated_at BEFORE UPDATE ON public.sequence_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sequence_edges
CREATE TABLE public.sequence_edges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id UUID NOT NULL,
  user_id UUID NOT NULL,
  source_node_id UUID NOT NULL,
  target_node_id UUID NOT NULL,
  source_handle TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sequence_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sequence_edges" ON public.sequence_edges
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_sequence_edges_sequence ON public.sequence_edges(sequence_id);

-- contact_activity
CREATE TABLE public.contact_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  sequence_id UUID,
  node_id UUID,
  activity_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contact_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own contact_activity" ON public.contact_activity
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_contact_activity_contact ON public.contact_activity(contact_id);

-- enrollments: add current_node_id
ALTER TABLE public.enrollments ADD COLUMN IF NOT EXISTS current_node_id UUID;
