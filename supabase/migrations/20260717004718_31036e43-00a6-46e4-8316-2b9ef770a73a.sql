CREATE TABLE public.stego_sessions (
  facebook_user_id text PRIMARY KEY,
  state text NOT NULL,
  pending_image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.stego_sessions TO service_role;

ALTER TABLE public.stego_sessions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER stego_sessions_updated_at
  BEFORE UPDATE ON public.stego_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();