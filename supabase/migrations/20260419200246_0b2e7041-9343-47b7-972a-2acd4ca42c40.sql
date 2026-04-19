ALTER TABLE public.sequences ADD COLUMN IF NOT EXISTS seeded boolean NOT NULL DEFAULT false;
-- Mark all existing sequences as seeded so they never re-seed
UPDATE public.sequences SET seeded = true WHERE seeded = false;