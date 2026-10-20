#!/usr/bin/env python3
"""Verify backups or prepare an atomic restore for an empty, isolated database.

This tool never connects to Supabase or reads the routine backup credential.
Generated SQL requires a separately authorised database administrator.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from portfolio_dropbox_backup import verify_backup_directory


TABLE_ORDER = [
    "app_members",
    "portfolio_transactions",
    "manual_values",
    "pension_values",
    "market_prices",
    "net_worth_snapshots",
    "portfolio_value_snapshots",
    "app_status",
    "research_statuses",
    "holding_name_overrides",
    "portfolio_report_settings",
    "portfolio_report_snapshots",
    "portfolio_report_holding_snapshots",
    "portfolio_report_runs",
    "drawdown_quotes",
    "drawdown_threshold_states",
    "drawdown_alerts",
    "drawdown_alert_receipts",
    "audit_log",
]

PRODUCTION_PROJECT_REF = "yeuqzpeawpwlslqntdkr"
SCHEMA_FILES = [
    "supabase-schema.sql",
    "holding-name-overrides-setup.sql",
    "portfolio-reports-setup.sql",
    "supabase/migrations/20260929010000_drawdown_alerts.sql",
]


def confirmation_for(project_ref: str) -> str:
    return f"PREPARE_ISOLATED_RESTORE_{project_ref}"


def validate_restore_data(data: dict) -> None:
    if not isinstance(data, dict) or set(data) != set(TABLE_ORDER):
        missing = sorted(set(TABLE_ORDER) - set(data)) if isinstance(data, dict) else TABLE_ORDER
        raise ValueError(f"A complete 19-table backup is required. Missing tables: {', '.join(missing)}")
    for table, rows in data.items():
        if not isinstance(rows, list) or any(not isinstance(row, dict) or not row for row in rows):
            raise ValueError(f"Invalid backup rows for {table}")
        if rows:
            columns = set(rows[0])
            if any(not re.fullmatch(r"[a-z_][a-z0-9_]*", name) for name in columns):
                raise ValueError(f"Invalid column name in {table}")
            if any(set(row) != columns for row in rows):
                raise ValueError(f"Inconsistent columns in {table}")


def validate_target(project_ref: str, system_id: str) -> None:
    if not re.fullmatch(r"[a-z]{20}", project_ref) or project_ref == PRODUCTION_PROJECT_REF:
        raise ValueError("Choose a separate recovery project, never the live portfolio project.")
    if not re.fullmatch(r"[0-9]{10,20}", system_id):
        raise ValueError("Read the target system_identifier from pg_control_system() first.")


def guard_sql(project_ref: str, system_id: str) -> str:
    validate_target(project_ref, system_id)
    return f"""-- PRIVATE recovery preparation for isolated project {project_ref}.
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = pg_catalog, public, pg_temp;
SET LOCAL lock_timeout = '10s';
DO $guard$
BEGIN
  IF (SELECT system_identifier::text FROM pg_control_system()) <> '{system_id}' THEN
    RAISE EXCEPTION 'Restore blocked: wrong database instance';
  END IF;
END;
$guard$;
"""


def build_schema_sql(project_ref: str, system_id: str) -> str:
    root = Path(__file__).resolve().parents[1]
    preflight = """DO $empty$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname='public') THEN
    RAISE EXCEPTION 'Schema setup blocked: public schema is not empty';
  END IF;
END;
$empty$;
"""
    # The guarded target is empty, so policy-replacement statements are unnecessary.
    scripts = ["\n".join(line for line in (root / name).read_text(encoding="utf-8").splitlines()
                         if not line.lower().startswith("drop policy if exists ")) for name in SCHEMA_FILES]
    return guard_sql(project_ref, system_id) + preflight + "SET LOCAL search_path = public, extensions;\n" + "\n".join(scripts) + "\nCOMMIT;\n"


def build_restore_sql(data: dict, project_ref: str, system_id: str) -> str:
    validate_target(project_ref, system_id)
    validate_restore_data(data)
    values = []
    for index, table in enumerate(TABLE_ORDER):
        payload = json.dumps(data[table], ensure_ascii=True, allow_nan=False, separators=(",", ":")).replace("'", "''")
        values.append(f"({index}, '{table}', '{payload}'::jsonb)")
    values_sql = ",\n".join(values)
    return guard_sql(project_ref, system_id) + f"""-- PRIVATE: contains portfolio data. Never commit or publish this file.
-- Isolated target: {project_ref}. No API keys or backup credentials are used.
CREATE TEMP TABLE portfolio_restore_expected (
  position integer PRIMARY KEY, table_name text UNIQUE NOT NULL, rows jsonb NOT NULL
) ON COMMIT DROP;
INSERT INTO pg_temp.portfolio_restore_expected VALUES
{values_sql};
DO $restore$
DECLARE
  item record;
  columns_sql text;
  row_count bigint;
  mismatch boolean;
  scheduled_jobs boolean;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT FROM cron.job WHERE active)' INTO scheduled_jobs;
    IF scheduled_jobs THEN
      RAISE EXCEPTION 'Restore blocked: target has active scheduled jobs';
    END IF;
  END IF;
  FOR item IN SELECT * FROM pg_temp.portfolio_restore_expected ORDER BY position LOOP
    IF to_regclass(format('public.%I', item.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Restore blocked: missing table %', item.table_name;
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', item.table_name);
    EXECUTE format('SELECT count(*) FROM public.%I', item.table_name) INTO row_count;
    IF row_count <> 0 THEN
      RAISE EXCEPTION 'Restore blocked: target table % is not empty', item.table_name;
    END IF;
    IF EXISTS (SELECT FROM pg_trigger WHERE tgrelid=to_regclass(format('public.%I', item.table_name)) AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'Restore blocked: restore data before installing application triggers on %', item.table_name;
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM pg_temp.portfolio_restore_expected ORDER BY position LOOP
    IF jsonb_array_length(item.rows) > 0 THEN
      SELECT string_agg(format('%I', key), ', ' ORDER BY key)
        INTO columns_sql FROM jsonb_object_keys(item.rows->0) AS key;
      EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)',
        item.table_name, columns_sql, columns_sql, item.table_name) USING item.rows;
      EXECUTE format('SELECT EXISTS ((SELECT %s FROM public.%I EXCEPT ALL SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)) UNION ALL (SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) EXCEPT ALL SELECT %s FROM public.%I))',
        columns_sql, item.table_name, columns_sql, item.table_name,
        columns_sql, item.table_name, columns_sql, item.table_name) INTO mismatch USING item.rows;
      IF mismatch THEN
        RAISE EXCEPTION 'Restore verification failed: content differs for %', item.table_name;
      END IF;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', item.table_name) INTO row_count;
    IF row_count <> jsonb_array_length(item.rows) THEN
      RAISE EXCEPTION 'Restore verification failed: row count differs for %', item.table_name;
    END IF;
  END LOOP;
END;
$restore$;
COMMIT;
"""


def write_private_sql(path: Path, sql: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(sql)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a backup or prepare a guarded restore into an empty recovery database.")
    parser.add_argument("backup", help="Path to a dated backup folder.")
    parser.add_argument("--apply", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--write-sql", type=Path, help="Write private restore SQL. This does not execute it.")
    parser.add_argument("--write-schema-sql", type=Path, help="Prepare the fresh target schema before restoring data.")
    parser.add_argument("--target-project-ref", default="", help="The separate, non-production recovery project.")
    parser.add_argument("--target-system-id", default="", help="Target pg_control_system() system_identifier.")
    parser.add_argument("--confirm", default="", help="PREPARE_ISOLATED_RESTORE_<target-project-ref>")
    args = parser.parse_args()

    if args.apply:
        parser.error("Direct API restores are disabled. Keep the backup credential read-only; prepare guarded SQL for a separate database instead.")
    backup_dir = Path(args.backup).expanduser().resolve()
    verify_backup_directory(backup_dir)
    data = json.loads((backup_dir / "portfolio-backup.json").read_text(encoding="utf-8"))
    print(f"Backup verified: {backup_dir}")
    for table in TABLE_ORDER:
        print(f"  {table}: {len(data.get(table, []))} rows")

    missing = sorted(set(TABLE_ORDER) - set(data))
    if missing:
        print(f"Incomplete portfolio coverage: missing {', '.join(missing)}", file=sys.stderr)
    if not args.write_sql and not args.write_schema_sql:
        print("Verification only. No database data was changed.")
        return 2 if missing else 0
    if args.confirm != confirmation_for(args.target_project_ref):
        parser.error("Confirm the exact isolated target with PREPARE_ISOLATED_RESTORE_<target-project-ref>.")
    validate_restore_data(data)
    if args.write_schema_sql:
        write_private_sql(args.write_schema_sql.expanduser(), build_schema_sql(args.target_project_ref, args.target_system_id))
        print(f"Private target schema SQL prepared: {args.write_schema_sql}")
    if args.write_sql:
        write_private_sql(args.write_sql.expanduser(), build_restore_sql(data, args.target_project_ref, args.target_system_id))
        print(f"Private restore SQL prepared: {args.write_sql}")
    print("No database connection was made. Authorised execution must use the checked recovery database, not the backup credential.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
