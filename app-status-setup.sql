create table if not exists public.app_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_status enable row level security;

grant select on public.app_status to authenticated;
grant select, insert, update on public.app_status to service_role;

drop policy if exists "members can read app status" on public.app_status;

create policy "members can read app status" on public.app_status
  for select
  to authenticated
  using (public.is_app_member());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_status'
  ) then
    alter publication supabase_realtime add table public.app_status;
  end if;
end $$;
