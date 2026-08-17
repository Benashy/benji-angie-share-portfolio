#!/usr/bin/env python3
"""Create a dated Supabase portfolio backup in Dropbox.

The script uses only the Python standard library so it can run on a normal Mac.
It expects a local env file containing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
Do not commit that env file to GitHub.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TABLES = [
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
    "app_members",
]

DEFAULT_BACKUP_DIR = Path.home() / "Library" / "CloudStorage" / "Dropbox" / "Portfolio Backups"
DEFAULT_ENV_FILE = Path(__file__).with_name("portfolio_backup.env")
DAILY_KEEP = 14
MONTHLY_KEEP = 24
FETCH_ATTEMPTS = 3
FETCH_RETRY_SECONDS = 90
PAGE_SIZE = 500
BACKUP_FORMAT_VERSION = 2


def load_env(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"Missing private config file: {path}")
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json_page(url: str, service_key: str) -> tuple[list[dict], int | None]:
    request = Request(
        url,
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Accept": "application/json",
            "Prefer": "count=exact",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode("utf-8"))
            content_range = response.headers.get("Content-Range", "")
            total_text = content_range.rsplit("/", 1)[-1] if "/" in content_range else ""
            total = int(total_text) if total_text.isdigit() else None
            return rows, total
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed {error.code}: {body}") from error
    except URLError as error:
        raise RuntimeError(f"Network request failed: {error.reason}") from error


def request_write(url: str, service_key: str, payload: dict) -> None:
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
        with urlopen(request, timeout=30):
            return
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase status update failed {error.code}: {body}") from error
    except URLError as error:
        raise RuntimeError(f"Network status update failed: {error.reason}") from error


def fetch_table(supabase_url: str, service_key: str, table: str) -> list[dict]:
    base_url = supabase_url.rstrip("/")
    rows: list[dict] = []
    expected_total: int | None = None
    offset = 0
    while True:
        params = urlencode({"select": "*", "limit": PAGE_SIZE, "offset": offset})
        page, total = request_json_page(f"{base_url}/rest/v1/{table}?{params}", service_key)
        if expected_total is None and total is not None:
            expected_total = total
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    if expected_total is not None and len(rows) != expected_total:
        raise RuntimeError(f"Backup row-count mismatch for {table}: expected {expected_total}, received {len(rows)}")
    return rows


def upsert_app_status(supabase_url: str, service_key: str, key: str, value: dict) -> None:
    base_url = supabase_url.rstrip("/")
    params = urlencode({"on_conflict": "key"})
    payload = {
        "key": key,
        "value": value,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    request_write(f"{base_url}/rest/v1/app_status?{params}", service_key, payload)


def fetch_all_tables(supabase_url: str, service_key: str) -> dict[str, list[dict]]:
    last_error: RuntimeError | None = None
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            return {table: fetch_table(supabase_url, service_key, table) for table in TABLES}
        except RuntimeError as error:
            last_error = error
            if attempt < FETCH_ATTEMPTS:
                print(f"Portfolio backup fetch attempt {attempt} failed: {error}")
                print(f"Retrying in {FETCH_RETRY_SECONDS} seconds...")
                time.sleep(FETCH_RETRY_SECONDS)
    raise last_error or RuntimeError("Supabase request failed.")


def write_csv(path: Path, rows: list[dict]) -> None:
    fields = sorted({key for row in rows for key in row.keys()})
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_backup_files(directory: Path, data: dict[str, list[dict]], created_at: str) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    json_path = directory / "portfolio-backup.json"
    summary_path = directory / "portfolio-summary.txt"
    json_path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    summary_path.write_text(build_summary(data, created_at), encoding="utf-8")
    for table, rows in data.items():
        write_csv(directory / f"{table}.csv", rows)
    files = [json_path, summary_path, *[directory / f"{table}.csv" for table in data]]
    manifest = {
        "format_version": BACKUP_FORMAT_VERSION,
        "created_at": created_at,
        "tables": {table: len(rows) for table, rows in data.items()},
        "files": {path.name: file_sha256(path) for path in files},
    }
    (directory / "backup-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return manifest


def verify_backup_directory(directory: Path) -> dict:
    manifest_path = directory / "backup-manifest.json"
    backup_path = directory / "portfolio-backup.json"
    if not manifest_path.exists() or not backup_path.exists():
        raise RuntimeError(f"Backup verification failed: required files are missing from {directory}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != BACKUP_FORMAT_VERSION:
        raise RuntimeError(f"Backup verification failed: unsupported format in {directory}")
    data = json.loads(backup_path.read_text(encoding="utf-8"))
    actual_counts = {table: len(rows) for table, rows in data.items()}
    if actual_counts != manifest.get("tables"):
        raise RuntimeError(f"Backup verification failed: table counts do not match in {directory}")
    for name, expected_hash in manifest.get("files", {}).items():
        path = directory / name
        if not path.exists() or file_sha256(path) != expected_hash:
            raise RuntimeError(f"Backup verification failed: checksum mismatch for {name}")
    return manifest


def money(value: float | int | None) -> str:
    if value is None:
        return "-"
    try:
        return f"GBP {float(value):,.0f}"
    except (TypeError, ValueError):
        return "-"


def latest_by_key(rows: list[dict], key: str) -> dict[str, dict]:
    latest: dict[str, dict] = {}
    for row in rows:
        name = str(row.get(key, ""))
        current = latest.get(name)
        row_time = row.get("updated_at") or row.get("created_at") or row.get("date") or ""
        current_time = current.get("updated_at") or current.get("created_at") or current.get("date") or "" if current else ""
        if not current or str(row_time) >= str(current_time):
            latest[name] = row
    return latest


def build_summary(data: dict[str, list[dict]], created_at: str) -> str:
    transactions = [row for row in data.get("portfolio_transactions", []) if not row.get("deleted_at")]
    manual_values = [row for row in data.get("manual_values", []) if not row.get("deleted_at")]
    pensions = [row for row in data.get("pension_values", []) if not row.get("deleted_at")]
    latest_snapshots = sorted(data.get("net_worth_snapshots", []), key=lambda row: row.get("month_key") or row.get("snapshot_date") or "", reverse=True)
    latest_snapshot = latest_snapshots[0] if latest_snapshots else {}

    cash_sign = {"deposit": 1, "sell": 1, "withdrawal": -1, "buy": -1}
    cash_total = sum(float(row.get("amount_gbp") or 0) * cash_sign.get(row.get("type"), 0) for row in transactions)
    crypto_latest = latest_by_key(manual_values, "account")
    pension_latest = latest_by_key(pensions, "name")

    lines = [
        "Benji and Angie's Investment Portfolio backup",
        f"Created: {created_at}",
        "",
        "Latest monthly snapshot",
        f"Headline net worth: {money(latest_snapshot.get('net_worth_total')) if latest_snapshot else '-'}",
        f"Portfolio: {money(latest_snapshot.get('accessible_total')) if latest_snapshot else '-'}",
        f"Cash: {money(latest_snapshot.get('cash_total')) if latest_snapshot else money(cash_total)}",
        f"Pension: {money(latest_snapshot.get('pension_total')) if latest_snapshot else '-'}",
        "",
        "Latest manual values",
    ]

    if crypto_latest:
        for row in crypto_latest.values():
            lines.append(f"{row.get('owner', '-')}: {row.get('account', '-')} - {money(row.get('value_gbp'))} on {row.get('date', '-')}")
    else:
        lines.append("No manual values found.")

    lines.extend(["", "Latest pension values"])
    if pension_latest:
        for row in pension_latest.values():
            lines.append(f"{row.get('name', '-')} - {money(row.get('value_gbp'))} on {row.get('date', '-')}")
    else:
        lines.append("No pension values found.")

    lines.extend([
        "",
        "Files included",
        "portfolio-backup.json contains the full database export.",
        "CSV files can be opened directly in Excel.",
    ])
    return "\n".join(lines) + "\n"


def prune_backups(root: Path) -> None:
    for folder_name, keep in [("daily", DAILY_KEEP), ("monthly", MONTHLY_KEEP)]:
        folder = root / folder_name
        if not folder.exists():
            continue
        try:
            backups = sorted([path for path in folder.iterdir() if path.is_dir()], key=lambda path: path.name, reverse=True)
        except OSError as error:
            if not isinstance(error, PermissionError):
                print(f"Backup pruning skipped for {folder}: {error}")
            continue
        for old in backups[keep:]:
            try:
                shutil.rmtree(old)
            except OSError as error:
                if not isinstance(error, PermissionError):
                    print(f"Could not remove old backup {old}: {error}")


def complete_daily_backup_today(root: Path, today_key: str) -> bool:
    daily_root = root / "daily"
    if not daily_root.exists():
        return False
    for backup_dir in daily_root.glob(f"{today_key}-*"):
        try:
            verify_backup_directory(backup_dir)
            return True
        except (OSError, RuntimeError, json.JSONDecodeError):
            continue
    return False


def successful_backup_today(latest_dir: Path, today_key: str) -> bool:
    marker = latest_dir / "last-successful-backup.json"
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return data.get("date") == today_key


def local_successful_backup_today(marker: Path, today_key: str) -> bool:
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return data.get("date") == today_key


def write_success_marker(latest_dir: Path, now: datetime, daily_dir: Path) -> None:
    marker = {
        "date": now.strftime("%Y-%m-%d"),
        "timestamp": now.isoformat(),
        "daily_backup": str(daily_dir),
    }
    (latest_dir / "last-successful-backup.json").write_text(json.dumps(marker, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Back up the portfolio Supabase database to Dropbox.")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to the private env file.")
    parser.add_argument("--backup-dir", default=str(DEFAULT_BACKUP_DIR), help="Dropbox backup folder.")
    parser.add_argument("--skip-if-today", action="store_true", help="Exit successfully if a scheduled backup already succeeded today.")
    args = parser.parse_args()

    env_file = Path(args.env_file).expanduser()
    load_env(env_file)
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    now = datetime.now(timezone.utc).astimezone()
    stamp = now.strftime("%Y-%m-%d-%H%M")
    created_at = now.strftime("%d-%m-%Y %H:%M %Z")
    root = Path(os.environ.get("BACKUP_DIR") or args.backup_dir).expanduser()
    daily_dir = root / "daily" / stamp
    monthly_dir = root / "monthly" / now.strftime("%Y-%m")
    latest_dir = root / "latest-scheduled"
    local_marker = env_file.with_name("last-successful-backup.json")
    today_key = now.strftime("%Y-%m-%d")

    if args.skip_if_today and (
        local_successful_backup_today(local_marker, today_key)
        or successful_backup_today(latest_dir, today_key)
        or complete_daily_backup_today(root, today_key)
    ):
        print(f"Portfolio backup skipped: successful backup already exists for {today_key}.")
        return 0

    try:
        data = fetch_all_tables(supabase_url, service_key)
    except RuntimeError as error:
        print(f"Portfolio backup failed: {error}", file=sys.stderr)
        print("Check that the Mac has internet access and that the Supabase secret key is correct.", file=sys.stderr)
        return 1
    if daily_dir.exists():
        shutil.rmtree(daily_dir)
    daily_dir.mkdir(parents=True, exist_ok=True)
    manifest = write_backup_files(daily_dir, data, created_at)
    verify_backup_directory(daily_dir)
    write_success_marker(daily_dir, now, daily_dir)
    write_success_marker(local_marker.parent, now, daily_dir)

    latest_refreshed = True
    try:
        latest_dir.mkdir(parents=True, exist_ok=True)
        write_backup_files(latest_dir, data, created_at)
        verify_backup_directory(latest_dir)
        write_success_marker(latest_dir, now, daily_dir)
    except OSError as error:
        latest_refreshed = False
        print(f"Latest scheduled backup refresh skipped: {error}")

    if now.day == 1 or not monthly_dir.exists():
        if monthly_dir.exists():
            shutil.rmtree(monthly_dir)
        shutil.copytree(daily_dir, monthly_dir)

    prune_backups(root)
    try:
        upsert_app_status(supabase_url, service_key, "dropbox_backup", {
            "status": "success",
            "timestamp": now.isoformat(),
            "daily_backup": str(daily_dir),
            "latest_scheduled": str(latest_dir) if latest_refreshed else None,
            "verified": True,
            "format_version": BACKUP_FORMAT_VERSION,
            "table_counts": manifest["tables"],
        })
    except RuntimeError as error:
        print(f"Backup completed, but app status update was skipped: {error}")
    print(f"Portfolio backup saved to {daily_dir}")
    print(f"Verified {sum(manifest['tables'].values())} rows across {len(manifest['tables'])} tables.")
    if latest_refreshed:
        print(f"Latest scheduled backup refreshed at {latest_dir}")
    else:
        print(f"Latest scheduled backup was not refreshed; dated backup is complete at {daily_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
