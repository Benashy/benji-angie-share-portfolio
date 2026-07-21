create table if not exists public.research_statuses (
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

alter table public.research_statuses enable row level security;

grant select, insert, update on public.research_statuses to authenticated;
grant select on public.research_statuses to service_role;

drop policy if exists "members can read research statuses" on public.research_statuses;
drop policy if exists "members can insert research statuses" on public.research_statuses;
drop policy if exists "members can update research statuses" on public.research_statuses;

create policy "members can read research statuses" on public.research_statuses
  for select using (public.is_app_member());

create policy "members can insert research statuses" on public.research_statuses
  for insert with check (public.is_app_member());

create policy "members can update research statuses" on public.research_statuses
  for update using (public.is_app_member())
  with check (public.is_app_member());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'research_statuses'
  ) then
    alter publication supabase_realtime add table public.research_statuses;
  end if;
end $$;
