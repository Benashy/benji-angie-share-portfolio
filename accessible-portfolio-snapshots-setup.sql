create table if not exists public.portfolio_value_snapshots (
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

alter table public.portfolio_value_snapshots enable row level security;

grant select, insert, update on public.portfolio_value_snapshots to authenticated;
grant select on public.portfolio_value_snapshots to service_role;

drop policy if exists "members can read portfolio value snapshots" on public.portfolio_value_snapshots;
drop policy if exists "members can insert portfolio value snapshots" on public.portfolio_value_snapshots;
drop policy if exists "members can update portfolio value snapshots" on public.portfolio_value_snapshots;

create policy "members can read portfolio value snapshots" on public.portfolio_value_snapshots
  for select using (public.is_app_member());

create policy "members can insert portfolio value snapshots" on public.portfolio_value_snapshots
  for insert with check (public.is_app_member());

create policy "members can update portfolio value snapshots" on public.portfolio_value_snapshots
  for update using (public.is_app_member())
  with check (public.is_app_member());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'portfolio_value_snapshots'
  ) then
    alter publication supabase_realtime add table public.portfolio_value_snapshots;
  end if;
end $$;
