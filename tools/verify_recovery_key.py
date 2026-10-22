#!/usr/bin/env python3
"""Verify a password-manager key offline. No service calls or live writes."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
from pathlib import Path
import sys
import warnings

from cryptography.fernet import Fernet, InvalidToken
import portfolio_full_recovery as recovery


def check_key(kit: Path, key: bytes) -> dict:
    try:
        Fernet(key)
    except (ValueError, TypeError):
        raise recovery.RecoveryCheckError("The key format was not recognised. Copy the entire Password field from 1Password.") from None
    try:
        payload = recovery.open_kit(kit, key)
    except InvalidToken:
        raise recovery.RecoveryCheckError("That key did not unlock this backup, or the file has been damaged. Keep the original key and backup unchanged.") from None
    if not isinstance(payload.get("auth_config"), dict) or not payload["auth_config"]:
        raise recovery.RecoveryCheckError("This is not the completed kit: login configuration is missing.")
    if not payload.get("secrets", {}).get("PORTFOLIO_TELEGRAM_BOT_TOKEN"):
        raise recovery.RecoveryCheckError("This is not the completed kit: the verified Telegram token is missing.")
    if set(payload.get("deployed_functions", {})) != set(recovery.FUNCTIONS):
        raise recovery.RecoveryCheckError("The recovery kit does not include all three deployed server functions.")
    snapshot = payload["snapshot"]
    # Generate only in memory, using a dummy target. Never execute any SQL.
    schedules = recovery.schedule_restore_sql(snapshot, "a" * 20, "1234567890123456789")
    if schedules.count("active := false") != len(recovery.EXPECTED_JOBS) or recovery.PRODUCTION_PROJECT_REF in schedules:
        raise recovery.RecoveryCheckError("The offline schedule recovery safety check failed. No schedules were run or changed.")
    return {
        "test": "independently_supplied_recovery_key",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "passed": True,
        "kit_filename": kit.name,
        "kit_sha256": hashlib.sha256(kit.read_bytes()).hexdigest(),
        "tables": len(snapshot["portfolio"]),
        "login_accounts": len(snapshot["auth_users"]),
        "schedules": len(snapshot["jobs"]),
        "server_functions": len(payload["deployed_functions"]),
        "source_checksum_valid": True,
        "restored_schedules_prepared_inactive": True,
        "network_requests": 0,
        "live_changes": False,
        "messages_sent": 0,
        "input_key_saved": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kit", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise recovery.RecoveryCheckError("Open Test Recovery Key.command in Terminal to use the hidden prompt.")
    print("Copy the saved key from 1Password, not from the original key file.")
    print("This test is offline. It does not save your pasted key or change the backup.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            key = getpass.getpass("Recovery unlock key from 1Password (hidden): ").strip().encode("ascii")
        except (UnicodeError, getpass.GetPassWarning):
            raise recovery.RecoveryCheckError("Could not read the key safely. Use the hidden Terminal prompt and copy the complete Password field.") from None
    report = check_key(args.kit, key)
    recovery.private_write(args.report, (json.dumps(report, indent=2) + "\n").encode())
    print("PASS: The key you supplied unlocked the completed recovery backup.")
    print(f"Verified {report['tables']} tables, {report['login_accounts']} login accounts, {report['schedules']} schedules and {report['server_functions']} server functions.")
    print("Source checksum and disabled-schedule recovery checks passed.")
    print("No network requests, live changes or messages. The pasted key was not saved.")
    print(f"Non-secret test report: {args.report}")
    return 0


def run_cli() -> int:
    try:
        return main()
    except recovery.RecoveryCheckError as error:
        print(f"Recovery key check stopped: {error}", file=sys.stderr)
    except (EOFError, KeyboardInterrupt):
        print("Recovery key check cancelled. Nothing was changed.", file=sys.stderr)
    except FileNotFoundError:
        print("The recovery backup could not be found. Ask Codex to check its location.", file=sys.stderr)
    except Exception as error:
        print(f"Recovery key check stopped ({type(error).__name__}). No live changes were made.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(run_cli())
