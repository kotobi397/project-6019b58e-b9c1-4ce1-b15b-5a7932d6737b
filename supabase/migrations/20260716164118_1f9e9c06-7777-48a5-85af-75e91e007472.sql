
-- User photos library
CREATE TABLE public.user_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_user_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime TEXT,
  size_bytes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_photos_user_created ON public.user_photos(facebook_user_id, created_at DESC);
GRANT ALL ON public.user_photos TO service_role;
ALTER TABLE public.user_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role only" ON public.user_photos FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Pending photo save prompts (image received, awaiting user decision)
CREATE TABLE public.pending_photo_saves (
  facebook_user_id TEXT PRIMARY KEY,
  urls JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.pending_photo_saves TO service_role;
ALTER TABLE public.pending_photo_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role only" ON public.pending_photo_saves FOR ALL TO service_role USING (true) WITH CHECK (true);
