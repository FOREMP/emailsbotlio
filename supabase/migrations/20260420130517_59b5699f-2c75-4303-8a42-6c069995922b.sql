ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS error_at timestamptz;