create table if not exists public.drawdown_quotes (
  ticker text primary key,
  holding text not null,
  currency text not null check (currency in ('GBP', 'USD')),
  close_date date not null,
  close_price numeric not null check (close_price > 0),
  high_date date not null,
  high_price numeric not null check (high_price > 0),
  drawdown_pct numeric not null check (drawdown_pct >= 0 and drawdown_pct <= 100),
  history_start_date date not null,
  full_year_history boolean not null default false,
  checked_at timestamptz not null default now()
);

create table if not exists public.drawdown_threshold_states (
  ticker text not null,
  threshold_pct integer not null check (threshold_pct in (10, 15, 20, 25)),
  armed boolean not null default true,
  last_evaluated_close_date date not null,
  updated_at timestamptz not null default now(),
  primary key (ticker, threshold_pct)
);

create table if not exists public.drawdown_alerts (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  holding text not null,
  threshold_pct integer not null check (threshold_pct in (10, 15, 20, 25)),
  close_date date not null,
  close_price numeric not null check (close_price > 0),
  high_date date not null,
  high_price numeric not null check (high_price > 0),
  drawdown_pct numeric not null check (drawdown_pct >= 0 and drawdown_pct <= 100),
  currency text not null check (currency in ('GBP', 'USD')),
  full_year_history boolean not null default false,
  created_at timestamptz not null default now(),
  unique (ticker, close_date)
);

create table if not exists public.drawdown_alert_receipts (
  alert_id uuid not null references public.drawdown_alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  telegram_sent_at timestamptz,
  telegram_error text,
  updated_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create index if not exists drawdown_alerts_ticker_created_idx
  on public.drawdown_alerts (ticker, created_at desc);
create index if not exists drawdown_alert_receipts_user_idx
  on public.drawdown_alert_receipts (user_id, updated_at desc);

alter table public.drawdown_quotes enable row level security;
alter table public.drawdown_threshold_states enable row level security;
alter table public.drawdown_alerts enable row level security;
alter table public.drawdown_alert_receipts enable row level security;

grant select on public.drawdown_quotes, public.drawdown_alerts, public.drawdown_alert_receipts to authenticated;
grant select, insert, update on public.drawdown_quotes, public.drawdown_threshold_states,
  public.drawdown_alerts, public.drawdown_alert_receipts to service_role;

create policy "members can read drawdown quotes" on public.drawdown_quotes
  for select to authenticated using ((select public.is_app_member()));
create policy "members can read drawdown alerts" on public.drawdown_alerts
  for select to authenticated using ((select public.is_app_member()));
create policy "members can read own drawdown receipts" on public.drawdown_alert_receipts
  for select to authenticated using (user_id = (select auth.uid()) and (select public.is_app_member()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drawdown_alerts'
  ) then
    alter publication supabase_realtime add table public.drawdown_alerts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drawdown_alert_receipts'
  ) then
    alter publication supabase_realtime add table public.drawdown_alert_receipts;
  end if;
end $$;
