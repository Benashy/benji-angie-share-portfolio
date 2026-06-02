create table if not exists public.net_worth_snapshots (
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

alter table public.net_worth_snapshots enable row level security;

grant select, insert, update on public.net_worth_snapshots to authenticated;

drop policy if exists "members can read net worth snapshots" on public.net_worth_snapshots;
drop policy if exists "members can insert net worth snapshots" on public.net_worth_snapshots;
drop policy if exists "members can update net worth snapshots" on public.net_worth_snapshots;

create policy "members can read net worth snapshots" on public.net_worth_snapshots
  for select using (public.is_app_member());

create policy "members can insert net worth snapshots" on public.net_worth_snapshots
  for insert with check (public.is_app_member());

create policy "members can update net worth snapshots" on public.net_worth_snapshots
  for update using (public.is_app_member())
  with check (public.is_app_member());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'net_worth_snapshots'
  ) then
    alter publication supabase_realtime add table public.net_worth_snapshots;
  end if;
end $$;
