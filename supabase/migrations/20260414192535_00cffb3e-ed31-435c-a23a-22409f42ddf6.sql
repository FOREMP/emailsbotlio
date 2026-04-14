
-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create review_sources table
CREATE TABLE public.review_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('trustpilot', 'google', 'manual')),
  name text NOT NULL,
  domain text,
  business_unit_id text,
  api_credentials jsonb DEFAULT '{}'::jsonb,
  last_synced_at timestamp with time zone,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.review_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own review sources"
  ON public.review_sources FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create reviews table
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.review_sources(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_id text,
  author_name text,
  rating integer CHECK (rating >= 1 AND rating <= 5),
  title text,
  review_text text,
  review_date timestamp with time zone,
  sentiment_score numeric(3,2) CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  sentiment_label text CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  themes jsonb DEFAULT '[]'::jsonb,
  key_phrases jsonb DEFAULT '[]'::jsonb,
  ai_response_draft text,
  response_posted boolean NOT NULL DEFAULT false,
  analyzed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own reviews"
  ON public.reviews FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_reviews_source_id ON public.reviews(source_id);
CREATE INDEX idx_reviews_review_date ON public.reviews(review_date);
CREATE INDEX idx_reviews_sentiment ON public.reviews(sentiment_label);
CREATE INDEX idx_reviews_rating ON public.reviews(rating);

-- Create review_insights table
CREATE TABLE public.review_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid REFERENCES public.review_sources(id) ON DELETE CASCADE,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  summary text,
  top_positive_themes jsonb DEFAULT '[]'::jsonb,
  top_negative_themes jsonb DEFAULT '[]'::jsonb,
  sentiment_avg numeric(3,2),
  review_count integer DEFAULT 0,
  avg_rating numeric(3,2),
  action_items jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.review_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own review insights"
  ON public.review_insights FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_review_insights_period ON public.review_insights(period_start, period_end);

-- Timestamp triggers
CREATE TRIGGER update_review_sources_updated_at
  BEFORE UPDATE ON public.review_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
