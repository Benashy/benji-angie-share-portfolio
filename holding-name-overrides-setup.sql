create table if not exists public.holding_name_overrides (
  ticker text primary key,
  display_name text not null,
  notes text not null default '',
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.holding_name_overrides enable row level security;

grant select, insert, update on public.holding_name_overrides to authenticated;
grant select on public.holding_name_overrides to service_role;

drop policy if exists "members can read holding name overrides" on public.holding_name_overrides;
drop policy if exists "members can insert holding name overrides" on public.holding_name_overrides;
drop policy if exists "members can update holding name overrides" on public.holding_name_overrides;

create policy "members can read holding name overrides" on public.holding_name_overrides
  for select using (public.is_app_member());

create policy "members can insert holding name overrides" on public.holding_name_overrides
  for insert with check (public.is_app_member());

create policy "members can update holding name overrides" on public.holding_name_overrides
  for update using (public.is_app_member());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'holding_name_overrides'
  ) then
    alter publication supabase_realtime add table public.holding_name_overrides;
  end if;
end $$;
