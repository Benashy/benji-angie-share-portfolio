create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  secret_value text;
begin
  select decrypted_secret
  into secret_value
  from vault.decrypted_secrets
  where name = 'portfolio_report_cron_secret'
  limit 1;

  if secret_value is null then
    secret_value := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(secret_value, 'portfolio_report_cron_secret');
  end if;
end $$;

create or replace function public.portfolio_report_cron_secret_matches(provided_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'portfolio_report_cron_secret'
      and decrypted_secret = provided_secret
  );
$$;

revoke all on function public.portfolio_report_cron_secret_matches(text) from public;
revoke all on function public.portfolio_report_cron_secret_matches(text) from anon;
revoke all on function public.portfolio_report_cron_secret_matches(text) from authenticated;
grant execute on function public.portfolio_report_cron_secret_matches(text) to service_role;

do $$
begin
  perform cron.unschedule('portfolio-telegram-reports');
exception
  when others then null;
end $$;

select cron.schedule(
  'portfolio-telegram-reports',
  '45 13,14 * * *',
  $$
  select net.http_post(
    url := 'https://yeuqzpeawpwlslqntdkr.supabase.co/functions/v1/portfolio-telegram-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'portfolio_report_cron_secret'
        limit 1
      )
    ),
    body := jsonb_build_object('action', 'run_schedule'),
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);
