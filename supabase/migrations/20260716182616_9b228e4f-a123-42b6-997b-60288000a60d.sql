
CREATE TABLE public.comment_reply_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id text UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  system_prompt text,
  reply_delay_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comment_reply_settings TO authenticated;
GRANT ALL ON public.comment_reply_settings TO service_role;
ALTER TABLE public.comment_reply_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage comment reply settings"
  ON public.comment_reply_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_crs_updated_at BEFORE UPDATE ON public.comment_reply_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.processed_comments (
  comment_id text PRIMARY KEY,
  page_id text,
  replied_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.processed_comments TO service_role;
ALTER TABLE public.processed_comments ENABLE ROW LEVEL SECURITY;

-- Seed a default row (applies to all pages when no page-specific row exists)
INSERT INTO public.comment_reply_settings (page_id, is_enabled, system_prompt)
VALUES (NULL, false, 'أنت مساعد ودود يمثل الصفحة. رد على تعليق المستخدم بشكل مختصر ومهذب باللغة العربية (سطر أو سطرين فقط). لا تذكر أنك ذكاء اصطناعي.');
