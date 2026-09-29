-- Two after-close attempts in UK/Lisbon time across daylight-saving changes.
-- The Edge Function checks the local time and skips the other UTC windows.
do $$
begin
  perform cron.unschedule('portfolio-drawdown-close');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('portfolio-drawdown-retry');
exception when others then null;
end $$;

select cron.schedule(
  'portfolio-drawdown-close',
  '45 20,21 * * 1-5',
  $$
  select net.http_post(
    url := 'https://yeuqzpeawpwlslqntdkr.supabase.co/functions/v1/portfolio-drawdown-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'portfolio_report_cron_secret' limit 1
      )
    ),
    body := '{"action":"run_schedule"}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);

select cron.schedule(
  'portfolio-drawdown-retry',
  '15 21,22 * * 1-5',
  $$
  select net.http_post(
    url := 'https://yeuqzpeawpwlslqntdkr.supabase.co/functions/v1/portfolio-drawdown-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'portfolio_report_cron_secret' limit 1
      )
    ),
    body := '{"action":"run_schedule"}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
