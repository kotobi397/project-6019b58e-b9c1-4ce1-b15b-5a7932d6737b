
-- Compression-proof fallback for steganography: store secret keyed by perceptual hash.
CREATE TABLE public.stego_hidden_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phash BYTEA NOT NULL,
  secret TEXT NOT NULL,
  owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stego_hidden_messages_phash_prefix_idx
  ON public.stego_hidden_messages (substring(phash from 1 for 4));
CREATE INDEX stego_hidden_messages_created_at_idx
  ON public.stego_hidden_messages (created_at DESC);

GRANT ALL ON public.stego_hidden_messages TO service_role;

ALTER TABLE public.stego_hidden_messages ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge function) touches this table. No client access.
CREATE POLICY "service role only"
  ON public.stego_hidden_messages
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
