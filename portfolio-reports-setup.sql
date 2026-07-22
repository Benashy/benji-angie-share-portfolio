create table if not exists public.portfolio_report_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolio_report_snapshots (
  snapshot_key text primary key,
  snapshot_date text not null,
  snapshot_kind text not null check (snapshot_kind in ('daily', 'weekly', 'monthly', 'manual')),
  accessible_total numeric not null,
  invested_total numeric not null,
  cash_total numeric not null,
  pension_total numeric not null,
  net_worth_total numeric not null,
  fx_rate numeric,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio_report_holding_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null references public.portfolio_report_snapshots(snapshot_key) on delete cascade,
  snapshot_date text not null,
  ticker text not null,
  holding text not null,
  quantity numeric not null default 0,
  value_gbp numeric not null default 0,
  weight numeric,
  gain_gbp_since_purchase numeric,
  gain_pct_since_purchase numeric,
  research_status text,
  created_at timestamptz not null default now(),
  unique(snapshot_key, ticker)
);

create table if not exists public.portfolio_report_runs (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('weekly', 'monthly', 'test_weekly', 'test_monthly', 'daily_snapshot')),
  period_start text,
  period_end text not null,
  status text not null default 'created' check (status in ('created', 'sent', 'skipped', 'failed')),
  message text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.portfolio_report_settings enable row level security;
alter table public.portfolio_report_snapshots enable row level security;
alter table public.portfolio_report_holding_snapshots enable row level security;
alter table public.portfolio_report_runs enable row level security;

grant select, insert, update on public.portfolio_report_settings to authenticated;
grant select on public.portfolio_report_snapshots to authenticated;
grant select on public.portfolio_report_holding_snapshots to authenticated;
grant select on public.portfolio_report_runs to authenticated;

grant select on public.app_members to service_role;
grant select on public.portfolio_transactions to service_role;
grant select on public.manual_values to service_role;
grant select on public.pension_values to service_role;
grant select, insert, update on public.market_prices to service_role;
grant select on public.net_worth_snapshots to service_role;
grant select on public.portfolio_value_snapshots to service_role;
grant select on public.research_statuses to service_role;
grant select, insert, update on public.portfolio_report_settings to service_role;
grant select, insert, update on public.portfolio_report_snapshots to service_role;
grant select, insert, update on public.portfolio_report_holding_snapshots to service_role;
grant select, insert, update on public.portfolio_report_runs to service_role;

drop policy if exists "members can read own report settings" on public.portfolio_report_settings;
drop policy if exists "members can insert own report settings" on public.portfolio_report_settings;
drop policy if exists "members can update own report settings" on public.portfolio_report_settings;
drop policy if exists "members can read report snapshots" on public.portfolio_report_snapshots;
drop policy if exists "members can read report holding snapshots" on public.portfolio_report_holding_snapshots;
drop policy if exists "members can read report runs" on public.portfolio_report_runs;

create policy "members can read own report settings" on public.portfolio_report_settings
  for select using ((select auth.uid()) = user_id);

create policy "members can insert own report settings" on public.portfolio_report_settings
  for insert with check ((select auth.uid()) = user_id);

create policy "members can update own report settings" on public.portfolio_report_settings
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "members can read report snapshots" on public.portfolio_report_snapshots
  for select using (public.is_app_member());

create policy "members can read report holding snapshots" on public.portfolio_report_holding_snapshots
  for select using (public.is_app_member());

create policy "members can read report runs" on public.portfolio_report_runs
  for select using (public.is_app_member());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portfolio_report_settings'
  ) then
    alter publication supabase_realtime add table public.portfolio_report_settings;
  end if;
end $$;
