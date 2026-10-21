#!/usr/bin/env python3
"""Encrypted, portable recovery kit. No production writes or message sends.

The normal backup key is not used. Capture is one read-only database query.
Only a separately authorised administrator can execute prepared restore SQL.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet
import pgpy

from portfolio_restore import (
    TABLE_ORDER, PRODUCTION_PROJECT_REF, build_schema_sql, build_restore_sql,
    guard_sql, validate_target, validate_restore_data, write_private_sql,
)

FORMAT = "portfolio-full-recovery-v1"
BOT_NAME = "SharePortfolioReminderBot"
EXPECTED_JOBS = {"portfolio-telegram-reports", "portfolio-drawdown-close", "portfolio-drawdown-retry"}
FUNCTIONS = {"refresh-prices": True, "portfolio-telegram-reports": False, "portfolio-drawdown-alerts": False}


class RecoveryCheckError(ValueError):
    """A fixed, credential-free explanation safe to display in Terminal."""


def private_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)


def read_key(path: Path) -> bytes:
    key = path.read_bytes().strip()
    Fernet(key)
    return key


def capture_sql(key: bytes) -> str:
    Fernet(key)
    passphrase = key.decode("ascii")
    tables = ",\n".join(f"'{name}', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.{name} t)" for name in TABLE_ORDER)
    # Encryption happens in the database: password hashes and Vault values never
    # appear in connector output or the SQL editor's result table as plaintext.
    return f"""with payload as (
select jsonb_build_object(
 'source_project', '{PRODUCTION_PROJECT_REF}', 'captured_at', now(),
 'portfolio', jsonb_build_object({tables}),
 'auth_users', (select coalesce(jsonb_agg(to_jsonb(u)-'confirmed_at'), '[]'::jsonb) from auth.users u where id in (select user_id from public.app_members)),
 'auth_identities', (select coalesce(jsonb_agg(to_jsonb(i)-'email'), '[]'::jsonb) from auth.identities i where user_id in (select user_id from public.app_members)),
 'verified_mfa', (select count(*) from auth.mfa_factors where status='verified'),
 'non_email_identities', (select count(*) from auth.identities where provider<>'email'),
 'storage_objects', (select count(*) from storage.objects),
 'storage_buckets', (select count(*) from storage.buckets),
 'vault', (select coalesce(jsonb_agg(jsonb_build_object('name',name,'value',decrypted_secret)), '[]'::jsonb) from vault.decrypted_secrets where name='portfolio_report_cron_secret'),
 'jobs', (select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'command',command)), '[]'::jsonb) from cron.job where jobname in ('portfolio-telegram-reports','portfolio-drawdown-close','portfolio-drawdown-retry')),
 'extensions', (select jsonb_agg(jsonb_build_object('name',extname,'version',extversion)) from pg_extension),
 'publications', (select coalesce(jsonb_agg(jsonb_build_object('publication',pubname,'schema',schemaname,'table',tablename)), '[]'::jsonb) from pg_publication_tables where schemaname='public')
) as data)
select encode(extensions.pgp_sym_encrypt(data::text, '{passphrase}', 'cipher-algo=aes256,compress-algo=1'), 'base64') as recovery_export from payload;
"""


def decrypt_capture(encoded: str, key: bytes) -> dict:
    packet = pgpy.PGPMessage.from_blob(base64.b64decode(encoded))
    message = packet.decrypt(key.decode("ascii")).message
    return json.loads(message)


def validate_snapshot(snapshot: dict) -> None:
    if snapshot.get("source_project") != PRODUCTION_PROJECT_REF:
        raise ValueError("Unexpected source project")
    validate_restore_data(snapshot["portfolio"])
    for field in ("verified_mfa", "non_email_identities", "storage_objects", "storage_buckets"):
        if snapshot.get(field) != 0:
            raise ValueError(f"Recovery needs additional support for {field}; do not mark this kit complete.")
    members = {row["user_id"] for row in snapshot["portfolio"]["app_members"]}
    users = {row["id"] for row in snapshot["auth_users"]}
    identities = {row["user_id"] for row in snapshot["auth_identities"]}
    if len(members) != 2 or members != users or members != identities:
        raise ValueError("The two approved login identities do not match the portfolio membership.")
    if any(row.get("provider") != "email" for row in snapshot["auth_identities"]):
        raise ValueError("Only email identities are supported by this recovery path.")
    if {row["name"] for row in snapshot["jobs"]} != EXPECTED_JOBS:
        raise ValueError("Missing or unexpected report schedules")


def seal(payload: dict, key: bytes) -> bytes:
    return Fernet(key).encrypt(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())


def open_kit(path: Path, key: bytes) -> dict:
    payload = json.loads(Fernet(key).decrypt(path.read_bytes()))
    if payload.get("format") != FORMAT:
        raise ValueError("Unsupported recovery kit format")
    validate_snapshot(payload["snapshot"])
    source = base64.b64decode(payload["source_tar"])
    if hashlib.sha256(source).hexdigest() != payload["source_sha256"]:
        raise ValueError("Source archive checksum failed")
    return payload


def make_kit(snapshot: dict, key: bytes, repo: Path, functions: dict) -> dict:
    validate_snapshot(snapshot)
    if set(functions) != set(FUNCTIONS):
        raise ValueError("Capture all three deployed Edge Functions")
    archive = subprocess.check_output(["git", "-C", str(repo), "archive", "--format=tar", "HEAD"])
    commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    return {
        "format": FORMAT, "created_at": datetime.now(timezone.utc).isoformat(),
        "source_commit": commit, "source_tar": base64.b64encode(archive).decode(),
        "source_sha256": hashlib.sha256(archive).hexdigest(), "snapshot": snapshot,
        "deployed_functions": functions, "auth_config": None, "secrets": {},
        "pending": ["auth_configuration", "telegram_bot_token", "external_account_recovery_codes"],
        "outbound_policy": "disabled_until_explicit_cutover",
    }


def extract_source(payload: dict, output: Path) -> None:
    if output.exists():
        raise ValueError("Choose a new, empty private output directory")
    output.mkdir(parents=True, mode=0o700)
    with tarfile.open(fileobj=io.BytesIO(base64.b64decode(payload["source_tar"]))) as archive:
        for entry in archive.getmembers():
            name = PurePosixPath(entry.name)
            if name.is_absolute() or ".." in name.parts or entry.issym() or entry.islnk():
                raise ValueError("Unsafe source archive path")
            if not entry.isfile():
                continue
            content = archive.extractfile(entry).read()
            private_write(output.joinpath(*name.parts), content)


def json_literal(value) -> str:
    return "'" + json.dumps(value, ensure_ascii=True, allow_nan=False).replace("'", "''") + "'::jsonb"


def auth_restore_sql(snapshot: dict, project: str, system_id: str, test_password: str | None = None) -> str:
    validate_target(project, system_id)
    validate_snapshot(snapshot)
    users, identities = json.loads(json.dumps([snapshot["auth_users"], snapshot["auth_identities"]]))
    for row in users:
        row.pop("confirmed_at", None)
    for row in identities:
        row.pop("email", None)
    for row in users:
        for field in ("confirmation_token", "recovery_token", "email_change_token_new", "email_change_token_current", "reauthentication_token", "phone_change_token"):
            if field in row:
                row[field] = ""
        for field in ("recovery_sent_at", "confirmation_sent_at", "email_change_sent_at", "reauthentication_sent_at", "phone_change_sent_at"):
            if field in row:
                row[field] = None
        row["email_change"] = ""
        row["phone_change"] = ""
        row["instance_id"] = "00000000-0000-0000-0000-000000000000"
        if test_password is not None:
            row["email"] = f"recovery-{row['id']}@example.invalid"
            row["encrypted_password"] = ""
            row["email_confirmed_at"] = datetime.now(timezone.utc).isoformat()
    if test_password is not None:
        emails = {u["id"]:u["email"] for u in users}
        for row in identities:
            row["identity_data"]["email"] = emails[row["user_id"]]
    parts = [guard_sql(project, system_id), """DO $empty$ BEGIN
IF EXISTS (SELECT FROM auth.users) OR EXISTS (SELECT FROM auth.identities) THEN
 RAISE EXCEPTION 'Auth recovery requires an empty target'; END IF;
END $empty$;
"""]
    for table, rows in (("users", users), ("identities", identities)):
        columns = sorted(rows[0])
        if any(not re.fullmatch(r"[a-z_][a-z0-9_]*", col) for col in columns):
            raise ValueError("Invalid auth column name")
        names = ",".join('"'+col+'"' for col in columns)
        parts.append(f"INSERT INTO auth.{table} ({names}) SELECT {names} FROM jsonb_populate_recordset(NULL::auth.{table}, {json_literal(rows)});\n")
    if test_password is not None:
        safe_password = test_password.replace("'", "''")
        ids = ",".join("'" + row["id"].replace("'", "''") + "'" for row in users)
        parts.append(f"UPDATE auth.users SET encrypted_password=extensions.crypt('{safe_password}',extensions.gen_salt('bf')) WHERE id IN ({ids});\n")
    parts.append("COMMIT;\n")
    return "".join(parts)


def schedule_restore_sql(snapshot: dict, project: str, system_id: str) -> str:
    validate_target(project, system_id)
    statements = [guard_sql(project, system_id), "CREATE EXTENSION IF NOT EXISTS pg_cron;\nCREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;\n"]
    # Schedules are recreated but disabled atomically, never briefly armed.
    for row in snapshot["jobs"]:
        command = row["command"].replace(PRODUCTION_PROJECT_REF, project)
        if PRODUCTION_PROJECT_REF in command or "api.telegram.org" in command:
            raise ValueError("Refusing a schedule with a production or direct Telegram endpoint")
        name, timing, command = (str(v).replace("'", "''") for v in (row["name"], row["schedule"], command))
        statements.append(f"DO $job$ DECLARE new_id bigint; BEGIN\nIF EXISTS(SELECT FROM cron.job WHERE jobname='{name}') THEN RAISE EXCEPTION 'Recovery schedule already exists'; END IF;\nnew_id := cron.schedule('{name}','{timing}','{command}');\nPERFORM cron.alter_job(new_id, active := false); END $job$;\n")
    statements.append("COMMIT;\n")
    return "".join(statements)


def service_restore_sql(project: str, system_id: str) -> str:
    # A new project uses a NEW internal scheduler secret, not the old value.
    return guard_sql(project, system_id) + """
SET LOCAL search_path=public,extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'portfolio_report_cron_secret')
WHERE NOT EXISTS(SELECT FROM vault.secrets WHERE name='portfolio_report_cron_secret');
CREATE OR REPLACE FUNCTION public.portfolio_report_cron_secret_matches(provided_secret text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $match$
 SELECT EXISTS(SELECT FROM vault.decrypted_secrets WHERE name='portfolio_report_cron_secret' AND decrypted_secret=provided_secret);
$match$;
REVOKE ALL ON FUNCTION public.portfolio_report_cron_secret_matches(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.portfolio_report_cron_secret_matches(text) TO service_role;
COMMIT;
"""


def integrity_restore_sql(project: str, system_id: str, root: Path | None = None) -> str:
    root = root or Path(__file__).resolve().parents[1]
    post = []
    for name in ("20260819010000_non_security_reliability.sql", "20261002151734_fix_optional_audit_fields.sql"):
        # This path is fresh-target only. Refuse existing application triggers
        # rather than removing them, preserving an accidental populated target.
        post.append("\n".join(line for line in (root / "supabase/migrations" / name).read_text().splitlines() if not re.search(r"\bdrop (trigger|constraint)\b", line, re.I)))
    preflight = """DO $fresh$ BEGIN
IF EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) THEN
 RAISE EXCEPTION 'Install integrity checks only on the fresh recovery schema'; END IF;
END $fresh$;
"""
    return guard_sql(project, system_id) + "SET LOCAL search_path=public,extensions;\n" + preflight + "\n".join(post) + "\nCOMMIT;\n"


def http_json(url: str, *, token: str | None = None) -> dict | list:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with urlopen(Request(url, headers=headers), timeout=30) as response:
            return json.load(response)
    except HTTPError as exc:
        # Do not include URLs, API responses or exception traces containing keys.
        if exc.code in (401, 403):
            detail = "Check the existing token and its read permissions. Do not regenerate the bot token."
        else:
            detail = "The service did not complete the read-only check."
        raise RecoveryCheckError(f"Private configuration check failed (HTTP {exc.code}). {detail}") from None
    except (URLError, TimeoutError, OSError):
        raise RecoveryCheckError("Could not connect for the private configuration check. Check the Mac's internet connection.") from None
    except (json.JSONDecodeError, UnicodeError):
        raise RecoveryCheckError("The service returned an unreadable configuration response. No credentials have been saved.") from None


def verify_bot_secret(secret_metadata: list, bot_token: str) -> None:
    if not isinstance(secret_metadata, list) or any(not isinstance(row, dict) for row in secret_metadata):
        raise RecoveryCheckError("Supabase returned an unexpected secret-list format. Stop here and report this message.")
    matching = [row for row in secret_metadata if row.get("name") == "PORTFOLIO_TELEGRAM_BOT_TOKEN"]
    if len(matching) != 1:
        raise RecoveryCheckError("The portfolio's deployed Telegram secret could not be identified. No live settings were changed.")
    # The Management API calls the SHA-256 fingerprint 'value', not 'digest'.
    # Accept the older metadata spelling too, but never accept a raw token here.
    row = matching[0]
    fingerprints = [row[name] for name in ("value", "digest") if row.get(name) is not None]
    if not fingerprints or any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", value) for value in fingerprints):
        raise RecoveryCheckError("Supabase returned an unrecognised Telegram token fingerprint. Stop here and report this message.")
    actual = hashlib.sha256(bot_token.encode()).hexdigest()
    if any(not hmac.compare_digest(value.lower(), actual) for value in fingerprints):
        raise RecoveryCheckError("The copied Telegram token does not match the one deployed for this portfolio. Copy its existing token from BotFather; do not revoke or regenerate it.")


def complete_kit(payload: dict, bot_token: str, management_token: str, *, progress=None) -> dict:
    report = progress or (lambda message: None)
    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]{20,}", bot_token):
        raise RecoveryCheckError("The Telegram token format was not recognised. Copy the entire number:code token, without surrounding text or spaces.")
    if not management_token:
        raise RecoveryCheckError("The Supabase management token was empty. Paste it into the second hidden prompt.")
    report("Checking Telegram bot identity...")
    bot = http_json(f"https://api.telegram.org/bot{bot_token}/getMe")
    if not isinstance(bot, dict) or not bot.get("ok") or not isinstance(bot.get("result"), dict) or str(bot["result"].get("username", "")).lower() != BOT_NAME.lower():
        raise RecoveryCheckError("This is not the SharePortfolioReminderBot token. Copy the existing token for that bot, without regenerating it.")
    report("Telegram bot identity confirmed. Reading Supabase login configuration...")
    base = f"https://api.supabase.com/v1/projects/{PRODUCTION_PROJECT_REF}"
    auth = http_json(base + "/config/auth", token=management_token)
    if not isinstance(auth, dict) or not auth:
        raise RecoveryCheckError("Supabase returned an unexpected login-configuration format. Stop here and report this message.")
    report("Login configuration received. Checking the deployed Telegram token fingerprint...")
    secret_metadata = http_json(base + "/secrets", token=management_token)
    verify_bot_secret(secret_metadata, bot_token)
    smtp_pass = auth.get("smtp_pass")
    if auth.get("smtp_host") and (not isinstance(smtp_pass, str) or not smtp_pass or "***" in smtp_pass):
        raise RecoveryCheckError("The custom email-service password was not returned. It must be added privately before completing the kit; stop here and report this message.")
    report("Deployed token confirmed. Preparing the encrypted recovery kit...")
    result = json.loads(json.dumps(payload))
    result["secrets"]["PORTFOLIO_TELEGRAM_BOT_TOKEN"] = bot_token
    result["auth_config"] = auth
    result["pending"] = ["external_account_recovery_codes"]
    result["credentials_verified_at"] = datetime.now(timezone.utc).isoformat()
    return result


def prepare(payload: dict, output: Path, project: str, system_id: str, publishable_key: str) -> None:
    validate_target(project, system_id)
    if not (publishable_key.startswith("sb_publishable_") or publishable_key.startswith("eyJ")):
        raise ValueError("Supply the target publishable key, never a secret key")
    if publishable_key.startswith("eyJ"):
        claims = json.loads(base64.urlsafe_b64decode(publishable_key.split(".")[1] + "=="))
        if claims.get("role") != "anon" or claims.get("ref") != project:
            raise ValueError("Wrong target publishable key")
    extract_source(payload, output / "source")
    snapshot = payload["snapshot"]
    write_private_sql(output / "01-schema.sql", build_schema_sql(project, system_id, output / "source"))
    write_private_sql(output / "02-auth.sql", auth_restore_sql(snapshot, project, system_id))
    write_private_sql(output / "03-data.sql", build_restore_sql(snapshot["portfolio"], project, system_id))
    write_private_sql(output / "04-integrity.sql", integrity_restore_sql(project, system_id, output / "source"))
    write_private_sql(output / "05-services.sql", service_restore_sql(project, system_id))
    write_private_sql(output / "06-disabled-schedules.sql", schedule_restore_sql(snapshot, project, system_id))
    # Never publish the recovered user's real configuration until an explicit
    # cutover. The test website connects only to the isolated target.
    (output / "source/config.js").write_text("window.PORTFOLIO_CONFIG = " + json.dumps({"supabaseUrl": f"https://{project}.supabase.co", "supabaseAnonKey": publishable_key, "demoMode": False}) + ";\n")
    private_write(output / "STATUS.json", json.dumps({"project": project, "system_id": system_id, "jobs_enabled": False, "pending": payload["pending"], "production_cutover": False}, indent=2).encode())


def recovery_test_function(files: list[dict], target: str, gate: str, prices: list[dict]) -> list[dict]:
    """Adapt only the disposable deployment. Never use this for production."""
    validate_target(target, "1000000000")
    if not re.fullmatch(r"[A-Za-z0-9_-]{24,}", gate):
        raise ValueError("Use a high-entropy recovery test gate")
    fixtures = {row["yahoo_symbol"]:row for row in prices}
    prelude = """
// DISPOSABLE RECOVERY TEST ONLY. No Telegram request can leave this function.
const __networkFetch = globalThis.fetch.bind(globalThis);
const __realDate = Date;
let __clock = __realDate.parse('2026-10-26T14:45:00Z');
class __TestDate extends __realDate {
  constructor(...args: any[]) { super(...(args.length ? args : [__clock]) as [any]); }
  static now() { return __clock; }
}
globalThis.Date = __TestDate as any;
let __captured = 0;
const __fixtures = FIXTURES;
globalThis.fetch = async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'api.telegram.org') { __captured++; return Response.json({ok:true,result:{message_id:__captured}}); }
  if (url.hostname.endsWith('.finance.yahoo.com')) {
    const symbol = decodeURIComponent(url.pathname.split('/').pop() || '');
    const row = __fixtures[symbol];
    if (!row) return Response.json({chart:{error:{description:'Missing recovery fixture'}}}, {status:404});
    const instrument = row.metrics?.instrument || {};
    const divisor = instrument.quote_unit === 'pence' ? 100 : 1;
    const price = Number(row.price)*divisor;
    const currency = divisor === 100 ? 'GBp' : row.currency;
    const timestamp = [Math.floor(__clock/1000)-86400*365, Math.floor(__clock/1000)-86400, Math.floor(__clock/1000)];
    return Response.json({chart:{error:null,result:[{meta:{symbol,currency,regularMarketPrice:price,regularMarketTime:Math.floor(__clock/1000),exchangeName:symbol.endsWith('.L')?'LSE':'NMS',instrumentType:'EQUITY',longName:instrument.name || row.ticker,fiftyTwoWeekHigh:price*1.4},timestamp,indicators:{quote:[{close:[price*1.4,price,price]}]}}]}});
  }
  if (url.hostname !== 'TARGET.supabase.co') throw new Error('Recovery test blocked an unexpected outbound destination');
  return __networkFetch(input,init);
};
const __serve = Deno.serve.bind(Deno);
Deno.serve = ((handler: any) => __serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:8539','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-recovery-test,x-recovery-clock'}});
  if (req.headers.get('x-recovery-test') !== 'GATE') return Response.json({error:'Private recovery test'}, {status:403});
  const clock = req.headers.get('x-recovery-clock');
  if (clock) { const value = __realDate.parse(clock); if (!Number.isFinite(value)) return Response.json({error:'Invalid clock'}, {status:400}); __clock=value; }
  __captured=0;
  const response = await handler(req);
  const result = await response.json().catch(()=>({}));
  return Response.json({...result,recovery_messages_captured:__captured,recovery_external_messages:0}, {status:response.status,headers:response.headers});
})) as any;
""".replace("FIXTURES", json.dumps(fixtures)).replace("TARGET", target).replace("GATE", gate)
    result = []
    for file in files:
        content = file["content"]
        if file["name"].endswith("index.ts"):
            content = content.replace('Deno.env.get("PORTFOLIO_TELEGRAM_BOT_TOKEN")', '"RECOVERY_CAPTURE_ONLY"')
            content = content.replace('return Deno.env.get(name) || "";', 'return name === "PORTFOLIO_TELEGRAM_BOT_TOKEN" ? "RECOVERY_CAPTURE_ONLY" : Deno.env.get(name) || "";')
            # The original dependencies and business logic are unchanged.
            content = prelude + "\n" + content
        result.append({"name":file["name"],"content":content})
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    init = sub.add_parser("init")
    init.add_argument("--key-file", type=Path, required=True)
    capture = sub.add_parser("capture-sql")
    capture.add_argument("--key-file", type=Path, required=True)
    capture.add_argument("--output", type=Path, required=True)
    assemble = sub.add_parser("assemble")
    assemble.add_argument("--key-file", type=Path, required=True)
    assemble.add_argument("--capture", type=Path, required=True)
    assemble.add_argument("--functions", type=Path, required=True)
    assemble.add_argument("--output", type=Path, required=True)
    verify = sub.add_parser("verify")
    complete = sub.add_parser("complete")
    for command in (verify, complete):
        command.add_argument("--key-file", type=Path, required=True)
        command.add_argument("--kit", type=Path, required=True)
    complete.add_argument("--output", type=Path, required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--key-file", type=Path, required=True)
    prep.add_argument("--kit", type=Path, required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--target-project", required=True)
    prep.add_argument("--target-system-id", required=True)
    prep.add_argument("--target-publishable-key", required=True)
    args = parser.parse_args()
    if args.action == "init":
        private_write(args.key_file, Fernet.generate_key() + b"\n")
        print("Private recovery key created. Store it separately in your password manager, never beside the kit.")
        return 0
    key = read_key(args.key_file)
    if args.action == "capture-sql":
        private_write(args.output, capture_sql(key).encode())
        print("Read-only encrypted capture query prepared. It contains the private recovery key; do not publish it.")
    elif args.action == "assemble":
        snapshot = decrypt_capture(json.loads(args.capture.read_text())["recovery_export"], key)
        payload = make_kit(snapshot, key, Path(__file__).resolve().parents[1], json.loads(args.functions.read_text()))
        private_write(args.output, seal(payload, key))
        print("Encrypted recovery kit created; bot token and login configuration still require private completion.")
    elif args.action == "complete":
        import getpass
        payload = open_kit(args.kit, key)
        bot_token = getpass.getpass("Existing Share Portfolio Telegram bot token (hidden): ").strip()
        management_token = getpass.getpass("Supabase project-scoped management token (hidden, not retained): ").strip()
        result = complete_kit(payload, bot_token, management_token, progress=lambda message: print(message, flush=True))
        private_write(args.output, seal(result, key))
        open_kit(args.output, key)
        print("Credentials checked without sending messages. Completed encrypted kit saved and verified.")
        print(f"Saved file: {args.output}")
        print("Separately check that GitHub, Supabase, Dropbox and Telegram account recovery codes are in your password manager.")
    elif args.action == "prepare":
        prepare(open_kit(args.kit, key), args.output, args.target_project, args.target_system_id, args.target_publishable_key)
        print("Private recovery files prepared for the isolated target. All schedules remain disabled.")
    else:
        payload = open_kit(args.kit, key)
        print(json.dumps({"format": FORMAT, "tables": len(payload["snapshot"]["portfolio"]), "accounts": len(payload["snapshot"]["auth_users"]), "schedules": len(payload["snapshot"]["jobs"]), "source_commit": payload["source_commit"], "pending": payload["pending"]}, indent=2))
    return 0


def run_cli() -> int:
    try:
        return main()
    except RecoveryCheckError as error:
        print(f"Recovery check stopped: {error}\nNo live changes were made.", file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print("Recovery check cancelled. No live changes were made.", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Recovery tool stopped: {type(error).__name__}. No live changes were made.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(run_cli())
