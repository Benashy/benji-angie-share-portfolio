#!/usr/bin/env python3
"""Read all portfolio tables into a private recovery-test backup, with no cloud writes."""

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from portfolio_dropbox_backup import fetch_all_tables, load_env, verify_backup_directory, write_backup_files
from portfolio_restore import validate_restore_data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    load_env(args.env_file.expanduser())
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise SystemExit("The existing private backup configuration is incomplete.")
    if args.output.exists():
        raise SystemExit("Choose a new recovery backup directory; existing backups are never overwritten.")
    data = fetch_all_tables(url, key)
    validate_restore_data(data)
    args.output.mkdir(parents=True, mode=0o700)
    write_backup_files(args.output, data, datetime.now(timezone.utc).isoformat())
    verify_backup_directory(args.output)
    for path in args.output.iterdir():
        path.chmod(0o600)
    print(f"Recovery backup verified: {len(data)} tables, {sum(map(len, data.values()))} rows.")
    print("Read-only export: no cloud status, schedule, settings or portfolio values were changed.")


if __name__ == "__main__":
    main()
