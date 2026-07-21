-- Phase-two shared portfolio schema.
-- Run this in the Supabase SQL editor after creating the project.

create extension if not exists "pgcrypto";

create table if not exists app_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (display_name in ('Benji', 'Angie')),
  created_at timestamptz not null default now()
);

create table if not exists portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  type text not null check (type in ('opening', 'buy', 'sell', 'deposit', 'withdrawal')),
  owner text not null check (owner in ('Benji', 'Angie')),
  account text not null,
  ticker text not null,
  holding text not null,
  quantity numeric not null default 0,
  price numeric not null default 0,
  currency text not null check (currency in ('GBP', 'USD')),
  amount_gbp numeric,
  cost_basis_gbp numeric,
  opening_value_gbp numeric,
  fees_gbp numeric not null default 0,
  notes text not null default '',
  is_locked boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists manual_values (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  ticker text not null,
  holding text not null,
  owner text not null check (owner in ('Benji', 'Angie')),
  account text not null,
  value_gbp numeric not null,
  currency_entered text check (currency_entered in ('GBP', 'USD')),
  value_entered numeric,
  notes text not null default '',
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists pension_values (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  name text not null,
  value_gbp numeric not null,
  cost_gbp numeric,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  event_time timestamptz not null default now(),
  user_id uuid references auth.users(id),
  display_name text,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_value jsonb,
  new_value jsonb
);

create table if not exists market_prices (
  ticker text primary key,
  yahoo_symbol text not null,
  price numeric not null,
  currency text not null,
  market_time timestamptz,
  metrics jsonb,
  fetched_at timestamptz not null default now(),
  source text not null default 'Yahoo'
);

create table if not exists net_worth_snapshots (
  month_key text primary key,
  snapshot_date text not null,
  net_worth_total numeric not null,
  accessible_total numeric not null,
  invested_total numeric not null,
  cash_total numeric not null,
  pension_total numeric not null,
  fx_rate numeric,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists portfolio_value_snapshots (
  snapshot_date text primary key,
  accessible_total numeric not null,
  invested_total numeric not null,
  cash_total numeric not null,
  fx_rate numeric,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists app_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists research_statuses (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  status text not null check (status in ('positive', 're_entry_watch', 'no_signal', 'watch', 'caution', 'baby_bear', 'mummy_bear', 'daddy_bear')),
  selected_date text not null,
  source_type text not null default 'Manual' check (source_type in ('Manual', 'PDF', 'Loom', 'Telegram', 'Email')),
  source_title text not null default '',
  source_url text not null default '',
  notes text not null default '',
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table app_members enable row level security;
alter table portfolio_transactions enable row level security;
alter table manual_values enable row level security;
alter table pension_values enable row level security;
alter table audit_log enable row level security;
alter table market_prices enable row level security;
alter table net_worth_snapshots enable row level security;
alter table portfolio_value_snapshots enable row level security;
alter table app_status enable row level security;
alter table research_statuses enable row level security;

create or replace function public.is_app_member()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_members
    where user_id = auth.uid()
  );
$$;

grant execute on function public.is_app_member() to authenticated;
grant usage on schema public to authenticated;
grant select on public.app_members to authenticated;
grant select, insert, update on public.portfolio_transactions to authenticated;
grant select, insert, update on public.manual_values to authenticated;
grant select, insert, update on public.pension_values to authenticated;
grant select, insert on public.audit_log to authenticated;
grant select, insert, update on public.market_prices to authenticated;
grant select, insert, update on public.net_worth_snapshots to authenticated;
grant select, insert, update on public.portfolio_value_snapshots to authenticated;
grant select on public.portfolio_value_snapshots to service_role;
grant select on public.app_status to authenticated;
grant select, insert, update on public.app_status to service_role;
grant select, insert, update on public.research_statuses to authenticated;
grant select on public.research_statuses to service_role;

create policy "members can read members" on app_members
  for select using (auth.uid() = user_id);

create policy "members can read transactions" on portfolio_transactions
  for select using (public.is_app_member());

create policy "members can insert transactions" on portfolio_transactions
  for insert with check (public.is_app_member());

create policy "members can update transactions" on portfolio_transactions
  for update using (public.is_app_member());

create policy "members can read manual values" on manual_values
  for select using (public.is_app_member());

create policy "members can insert manual values" on manual_values
  for insert with check (public.is_app_member());

create policy "members can update manual values" on manual_values
  for update using (public.is_app_member());

create policy "members can read pensions" on pension_values
  for select using (public.is_app_member());

create policy "members can insert pensions" on pension_values
  for insert with check (public.is_app_member());

create policy "members can update pensions" on pension_values
  for update using (public.is_app_member());

create policy "members can read audit log" on audit_log
  for select using (public.is_app_member());

create policy "members can insert audit log" on audit_log
  for insert with check (public.is_app_member());

create policy "members can read market prices" on market_prices
  for select using (public.is_app_member());

create policy "members can insert market prices" on market_prices
  for insert with check (public.is_app_member());

create policy "members can update market prices" on market_prices
  for update using (public.is_app_member())
  with check (public.is_app_member());

create policy "members can read net worth snapshots" on net_worth_snapshots
  for select using (public.is_app_member());

create policy "members can insert net worth snapshots" on net_worth_snapshots
  for insert with check (public.is_app_member());

create policy "members can update net worth snapshots" on net_worth_snapshots
  for update using (public.is_app_member())
  with check (public.is_app_member());

create policy "members can read portfolio value snapshots" on portfolio_value_snapshots
  for select using (public.is_app_member());

create policy "members can insert portfolio value snapshots" on portfolio_value_snapshots
  for insert with check (public.is_app_member());

create policy "members can update portfolio value snapshots" on portfolio_value_snapshots
  for update using (public.is_app_member())
  with check (public.is_app_member());

create policy "members can read app status" on app_status
  for select using (public.is_app_member());

create policy "members can read research statuses" on research_statuses
  for select using (public.is_app_member());

create policy "members can insert research statuses" on research_statuses
  for insert with check (public.is_app_member());

create policy "members can update research statuses" on research_statuses
  for update using (public.is_app_member())
  with check (public.is_app_member());

-- Enable realtime after tables exist. The checks make this safe to rerun.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portfolio_transactions'
  ) then
    alter publication supabase_realtime add table portfolio_transactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'manual_values'
  ) then
    alter publication supabase_realtime add table manual_values;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pension_values'
  ) then
    alter publication supabase_realtime add table pension_values;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'market_prices'
  ) then
    alter publication supabase_realtime add table market_prices;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'net_worth_snapshots'
  ) then
    alter publication supabase_realtime add table net_worth_snapshots;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portfolio_value_snapshots'
  ) then
    alter publication supabase_realtime add table portfolio_value_snapshots;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_status'
  ) then
    alter publication supabase_realtime add table app_status;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'research_statuses'
  ) then
    alter publication supabase_realtime add table research_statuses;
  end if;
end $$;
