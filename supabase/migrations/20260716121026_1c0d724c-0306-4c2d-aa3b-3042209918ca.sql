
CREATE TABLE public.facebook_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id text NOT NULL UNIQUE,
  page_name text,
  page_access_token text NOT NULL,
  verify_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.facebook_pages TO authenticated;
GRANT ALL ON public.facebook_pages TO service_role;

ALTER TABLE public.facebook_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage facebook pages"
ON public.facebook_pages FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_facebook_pages_updated_at
BEFORE UPDATE ON public.facebook_pages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
