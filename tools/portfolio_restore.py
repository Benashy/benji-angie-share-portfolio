#!/usr/bin/env python3
"""Verify or restore a portfolio backup.

The default mode is a read-only verification. Applying a restore only upserts
rows, so it never deletes records that are absent from the backup.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from portfolio_dropbox_backup import DEFAULT_ENV_FILE, load_env, verify_backup_directory


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
    "audit_log",
]

CONFLICT_COLUMNS = {
    "app_members": "user_id",
    "portfolio_transactions": "id",
    "manual_values": "id",
    "pension_values": "id",
    "market_prices": "ticker",
    "net_worth_snapshots": "month_key",
    "portfolio_value_snapshots": "snapshot_date",
    "app_status": "key",
    "research_statuses": "id",
    "holding_name_overrides": "ticker",
    "portfolio_report_settings": "user_id",
    "portfolio_report_snapshots": "snapshot_key",
    "portfolio_report_holding_snapshots": "id",
    "portfolio_report_runs": "id",
    "audit_log": "id",
}

CONFIRMATION = "UPSERT_VERIFIED_PORTFOLIO_BACKUP"


def upsert_rows(base_url: str, service_key: str, table: str, rows: list[dict]) -> None:
    if not rows:
        return
    params = urlencode({"on_conflict": CONFLICT_COLUMNS[table]})
    url = f"{base_url.rstrip('/')}/rest/v1/{table}?{params}"
    for start in range(0, len(rows), 200):
        payload = rows[start:start + 200]
        request = Request(
            url,
            method="POST",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urlopen(request, timeout=60):
                pass
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Restore failed for {table}: {error.code} {body}") from error
        except URLError as error:
            raise RuntimeError(f"Restore network failure for {table}: {error.reason}") from error


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify or restore a portfolio Dropbox backup.")
    parser.add_argument("backup", help="Path to a dated backup folder.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Private Supabase environment file.")
    parser.add_argument("--apply", action="store_true", help="Upsert the verified backup into Supabase.")
    parser.add_argument("--confirm", default="", help=f"Required with --apply: {CONFIRMATION}")
    args = parser.parse_args()

    backup_dir = Path(args.backup).expanduser().resolve()
    manifest = verify_backup_directory(backup_dir)
    data = json.loads((backup_dir / "portfolio-backup.json").read_text(encoding="utf-8"))
    print(f"Backup verified: {backup_dir}")
    for table in TABLE_ORDER:
        print(f"  {table}: {len(data.get(table, []))} rows")

    if not args.apply:
        print("Verification only. No database data was changed.")
        return 0
    if args.confirm != CONFIRMATION:
        print(f"Restore not applied. Re-run with --confirm {CONFIRMATION} after checking the target project.", file=sys.stderr)
        return 2

    load_env(Path(args.env_file).expanduser())
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    for table in TABLE_ORDER:
        upsert_rows(supabase_url, service_key, table, data.get(table, []))
        print(f"Restored {table}: {len(data.get(table, []))} rows")
    print(f"Restore completed from backup format {manifest['format_version']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
