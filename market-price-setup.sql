create table if not exists public.market_prices (
  ticker text primary key,
  yahoo_symbol text not null,
  price numeric not null,
  currency text not null,
  market_time timestamptz,
  metrics jsonb,
  fetched_at timestamptz not null default now(),
  source text not null default 'Yahoo'
);

alter table public.market_prices enable row level security;
alter table public.market_prices add column if not exists metrics jsonb;

grant select on public.market_prices to authenticated;

drop policy if exists "members can read market prices" on public.market_prices;

create policy "members can read market prices" on public.market_prices
  for select using (public.is_app_member());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'market_prices'
  ) then
    alter publication supabase_realtime add table public.market_prices;
  end if;
end $$;
