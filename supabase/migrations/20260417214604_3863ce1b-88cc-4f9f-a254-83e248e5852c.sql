-- Track every file the user imports (we don't keep the file itself, just metadata + extracted info)
CREATE TABLE public.imported_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  list_id UUID REFERENCES public.contact_lists(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  file_type TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  column_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  columns_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.imported_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own imported_files"
  ON public.imported_files
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_imported_files_user_created ON public.imported_files(user_id, created_at DESC);
CREATE INDEX idx_imported_files_list ON public.imported_files(list_id);