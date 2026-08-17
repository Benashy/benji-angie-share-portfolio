-- Non-security reliability safeguards for portfolio writes.

alter table public.portfolio_transactions add column if not exists client_request_id uuid;
alter table public.portfolio_transactions add column if not exists fx_rate_used numeric;
alter table public.manual_values add column if not exists client_request_id uuid;
alter table public.pension_values add column if not exists client_request_id uuid;

update public.portfolio_transactions set client_request_id = gen_random_uuid() where client_request_id is null;
update public.manual_values set client_request_id = gen_random_uuid() where client_request_id is null;
update public.pension_values set client_request_id = gen_random_uuid() where client_request_id is null;

alter table public.portfolio_transactions alter column client_request_id set default gen_random_uuid();
alter table public.portfolio_transactions alter column client_request_id set not null;
alter table public.manual_values alter column client_request_id set default gen_random_uuid();
alter table public.manual_values alter column client_request_id set not null;
alter table public.pension_values alter column client_request_id set default gen_random_uuid();
alter table public.pension_values alter column client_request_id set not null;

create unique index if not exists portfolio_transactions_client_request_id_key
  on public.portfolio_transactions (client_request_id);
create unique index if not exists manual_values_client_request_id_key
  on public.manual_values (client_request_id);
create unique index if not exists pension_values_client_request_id_key
  on public.pension_values (client_request_id);

alter table public.portfolio_transactions drop constraint if exists portfolio_transactions_values_valid;
alter table public.portfolio_transactions add constraint portfolio_transactions_values_valid check (
  deleted_at is not null
  or (
    (
      type = 'opening'
      and quantity > 0
      and price > 0
      and coalesce(amount_gbp, 0) >= 0
    )
    or (
      type in ('buy', 'sell')
      and quantity > 0
      and price > 0
      and amount_gbp > 0
    )
    or (
      type in ('deposit', 'withdrawal')
      and quantity = 0
      and price = 0
      and amount_gbp > 0
    )
  )
) not valid;
alter table public.portfolio_transactions validate constraint portfolio_transactions_values_valid;

alter table public.portfolio_transactions drop constraint if exists portfolio_transactions_fx_rate_valid;
alter table public.portfolio_transactions add constraint portfolio_transactions_fx_rate_valid check (
  fx_rate_used is null or fx_rate_used > 0
) not valid;
alter table public.portfolio_transactions validate constraint portfolio_transactions_fx_rate_valid;

alter table public.manual_values drop constraint if exists manual_values_positive_value;
alter table public.manual_values add constraint manual_values_positive_value check (
  value_gbp > 0 and (value_entered is null or value_entered > 0)
) not valid;
alter table public.manual_values validate constraint manual_values_positive_value;

alter table public.pension_values drop constraint if exists pension_values_positive_value;
alter table public.pension_values add constraint pension_values_positive_value check (value_gbp > 0) not valid;
alter table public.pension_values validate constraint pension_values_positive_value;

create or replace function public.portfolio_transaction_date_value(raw_date text)
returns date
language sql
immutable
strict
as $$
  select case
    when raw_date ~ '^\d{4}-\d{2}-\d{2}$' then to_date(raw_date, 'YYYY-MM-DD')
    when raw_date ~ '^\d{1,2}\.\d{1,2}\.\d{2,4}$' then
      to_date(
        split_part(raw_date, '.', 1) || '.' || split_part(raw_date, '.', 2) || '.' ||
        case when length(split_part(raw_date, '.', 3)) = 2 then '20' || split_part(raw_date, '.', 3) else split_part(raw_date, '.', 3) end,
        'DD.MM.YYYY'
      )
    else null
  end;
$$;

create or replace function public.validate_portfolio_transaction_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  has_negative boolean;
begin
  if tg_op <> 'INSERT' and old.ticker <> 'CASH' then
    select exists (
      select 1
      from (
        select sum(case when type in ('opening', 'buy') then quantity when type = 'sell' then -quantity else 0 end)
          over (order by public.portfolio_transaction_date_value(date), case when type = 'opening' then 0 else 1 end, created_at, id) as running_quantity
        from public.portfolio_transactions
        where deleted_at is null and owner = old.owner and account = old.account and ticker = old.ticker
      ) ordered_rows
      where running_quantity < -0.00000001
    ) into has_negative;
    if has_negative then
      raise exception 'This change would sell more % shares than are available in the account.', old.ticker using errcode = '23514';
    end if;
  end if;

  if tg_op <> 'DELETE' and new.ticker <> 'CASH' then
    select exists (
      select 1
      from (
        select sum(case when type in ('opening', 'buy') then quantity when type = 'sell' then -quantity else 0 end)
          over (order by public.portfolio_transaction_date_value(date), case when type = 'opening' then 0 else 1 end, created_at, id) as running_quantity
        from public.portfolio_transactions
        where deleted_at is null and owner = new.owner and account = new.account and ticker = new.ticker
      ) ordered_rows
      where running_quantity < -0.00000001
    ) into has_negative;
    if has_negative then
      raise exception 'This change would sell more % shares than are available in the account.', new.ticker using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists portfolio_transaction_integrity_trigger on public.portfolio_transactions;
create trigger portfolio_transaction_integrity_trigger
after insert or update or delete
on public.portfolio_transactions
for each row execute function public.validate_portfolio_transaction_integrity();

create or replace function public.record_portfolio_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_value jsonb;
  new_value jsonb;
  activity text;
  actor_name text;
  record_uuid uuid;
  record_text text;
begin
  old_value := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_value := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  record_text := coalesce(new_value ->> 'id', old_value ->> 'id');
  if record_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    record_uuid := record_text::uuid;
  end if;
  select display_name into actor_name from public.app_members where user_id = auth.uid();

  if tg_op = 'INSERT' then
    activity := case
      when tg_table_name in ('manual_values', 'pension_values') then 'manual_update'
      when tg_table_name = 'research_statuses' then 'research_status_add'
      when tg_table_name = 'holding_name_overrides' then 'holding_name_add'
      when tg_table_name = 'portfolio_transactions' and coalesce(new.notes, '') = 'Cash balance confirmation adjustment' then 'cash_reconcile'
      else 'add'
    end;
  elsif tg_op = 'UPDATE' then
    activity := case
      when old.deleted_at is null and new.deleted_at is not null then
        case when tg_table_name = 'holding_name_overrides' then 'holding_name_reset' else 'soft_delete' end
      when tg_table_name = 'research_statuses' then 'research_status_update'
      when tg_table_name = 'holding_name_overrides' then 'holding_name_update'
      else 'edit'
    end;
  else
    activity := 'delete';
  end if;

  insert into public.audit_log (user_id, display_name, action, table_name, record_id, old_value, new_value)
  values (auth.uid(), actor_name, activity, tg_table_name, record_uuid, old_value, new_value);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'portfolio_transactions',
    'manual_values',
    'pension_values',
    'research_statuses',
    'holding_name_overrides'
  ]
  loop
    execute format('drop trigger if exists portfolio_activity_trigger on public.%I', table_name);
    execute format(
      'create trigger portfolio_activity_trigger after insert or update or delete on public.%I for each row execute function public.record_portfolio_activity()',
      table_name
    );
  end loop;
end;
$$;
