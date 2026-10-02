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

  -- Optional fields differ across the tables sharing this trigger.
  if tg_op = 'INSERT' then
    activity := case
      when tg_table_name in ('manual_values', 'pension_values') then 'manual_update'
      when tg_table_name = 'research_statuses' then 'research_status_add'
      when tg_table_name = 'holding_name_overrides' then 'holding_name_add'
      when tg_table_name = 'portfolio_transactions' and coalesce(new_value ->> 'notes', '') = 'Cash balance confirmation adjustment' then 'cash_reconcile'
      else 'add'
    end;
  elsif tg_op = 'UPDATE' then
    activity := case
      when old_value ->> 'deleted_at' is null and new_value ->> 'deleted_at' is not null then
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

