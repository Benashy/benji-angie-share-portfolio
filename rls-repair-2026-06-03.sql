grant usage on schema public to authenticated;
grant select on public.app_members to authenticated;
grant select, insert, update on public.net_worth_snapshots to authenticated;
grant select, insert, update on public.portfolio_transactions to authenticated;

drop policy if exists "members can read net worth snapshots" on public.net_worth_snapshots;
drop policy if exists "members can insert net worth snapshots" on public.net_worth_snapshots;
drop policy if exists "members can update net worth snapshots" on public.net_worth_snapshots;

create policy "members can read net worth snapshots" on public.net_worth_snapshots
  for select using (
    exists (
      select 1 from public.app_members
      where app_members.user_id = auth.uid()
    )
  );

create policy "members can insert net worth snapshots" on public.net_worth_snapshots
  for insert with check (
    exists (
      select 1 from public.app_members
      where app_members.user_id = auth.uid()
    )
  );

create policy "members can update net worth snapshots" on public.net_worth_snapshots
  for update using (
    exists (
      select 1 from public.app_members
      where app_members.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.app_members
      where app_members.user_id = auth.uid()
    )
  );

drop policy if exists "members can update transactions" on public.portfolio_transactions;

create policy "members can update transactions" on public.portfolio_transactions
  for update using (
    exists (
      select 1 from public.app_members
      where app_members.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.app_members
      where app_members.user_id = auth.uid()
    )
  );
