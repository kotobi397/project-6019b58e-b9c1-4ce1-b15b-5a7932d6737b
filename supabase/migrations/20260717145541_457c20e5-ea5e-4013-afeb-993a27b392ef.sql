
CREATE TABLE public.phone_lookups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  owner_name TEXT,
  carrier TEXT,
  facebook_user_id TEXT,
  page_id TEXT,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX phone_lookups_status_idx ON public.phone_lookups (status, created_at);
CREATE INDEX phone_lookups_fb_user_idx ON public.phone_lookups (facebook_user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.phone_lookups TO authenticated;
GRANT ALL ON public.phone_lookups TO service_role;

ALTER TABLE public.phone_lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read all phone lookups"
  ON public.phone_lookups FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated insert own phone lookups"
  ON public.phone_lookups FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() OR requested_by IS NULL);

CREATE TRIGGER update_phone_lookups_updated_at
  BEFORE UPDATE ON public.phone_lookups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.phone_lookups;
