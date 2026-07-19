
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove old schedule if any
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'poll-temp-emails';

SELECT cron.schedule(
  'poll-temp-emails',
  '* * * * *',
  $$
  SELECT net.http_get(
    url := 'https://znepqljtvkumdqlohbwq.supabase.co/functions/v1/messenger?action=poll_temp_emails',
    headers := jsonb_build_object(
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZXBxbGp0dmt1bWRxbG9oYndxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNDU2MTEsImV4cCI6MjA5NzgyMTYxMX0.KG8XFdZYtDh62U-cgshTgESBH5-LaTWpU7jzv9VBNyE'
    )
  );
  $$
);
