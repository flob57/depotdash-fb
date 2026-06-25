
SELECT cron.unschedule('nightly-notion-export');

SELECT cron.schedule(
  'nightly-notion-export',
  '59 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4b8fb807-184c-4370-be2b-aae5510e0cfa.lovable.app/api/public/cron/nightly-export',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "2-a8pyqg00Nv5PWP0os6hNQ9wUTMixhE8nOGYr5QGlgMePvh"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
