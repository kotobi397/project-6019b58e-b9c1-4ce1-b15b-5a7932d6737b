CREATE TABLE public.virustotal_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  verdict TEXT NOT NULL,
  malicious_count INT NOT NULL DEFAULT 0,
  suspicious_count INT NOT NULL DEFAULT 0,
  harmless_count INT NOT NULL DEFAULT 0,
  undetected_count INT NOT NULL DEFAULT 0,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_virustotal_cache_created_at ON public.virustotal_cache (created_at DESC);

GRANT ALL ON public.virustotal_cache TO service_role;

ALTER TABLE public.virustotal_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.virustotal_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_virustotal_cache_updated_at
  BEFORE UPDATE ON public.virustotal_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();