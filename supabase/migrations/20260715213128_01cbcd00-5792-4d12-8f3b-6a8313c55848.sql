
CREATE TABLE public.temp_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_user_id text NOT NULL,
  address text NOT NULL,
  password text NOT NULL,
  mail_tm_account_id text,
  token text,
  last_message_id text,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_temp_emails_fb_user ON public.temp_emails(facebook_user_id) WHERE active = true;
CREATE INDEX idx_temp_emails_active ON public.temp_emails(active, expires_at) WHERE active = true;

GRANT SELECT ON public.temp_emails TO authenticated;
GRANT ALL ON public.temp_emails TO service_role;

ALTER TABLE public.temp_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view temp_emails"
  ON public.temp_emails FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_temp_emails_updated_at
  BEFORE UPDATE ON public.temp_emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
