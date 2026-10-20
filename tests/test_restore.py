import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from portfolio_dropbox_backup import verify_backup_directory, write_backup_files
from portfolio_restore import PRODUCTION_PROJECT_REF, TABLE_ORDER, build_restore_sql, build_schema_sql, validate_restore_data, write_private_sql

TARGET = "abcdefghijklmnopqrst"
SYSTEM_ID = "7692130048193495360"


class RestoreTests(unittest.TestCase):
    def complete_data(self):
        return {table: [] for table in TABLE_ORDER}

    def test_live_project_and_malformed_targets_are_blocked(self):
        for target in (PRODUCTION_PROJECT_REF, "", "https://example.com", "x' OR true--"):
            with self.assertRaises(ValueError):
                build_restore_sql(self.complete_data(), target, SYSTEM_ID)
        with self.assertRaises(ValueError):
            build_restore_sql(self.complete_data(), TARGET, "1'; DELETE")

    def test_restore_is_atomic_and_checks_target_before_any_insert(self):
        sql = build_restore_sql(self.complete_data(), TARGET, SYSTEM_ID)
        self.assertIn("BEGIN;", sql)
        self.assertTrue(sql.endswith("COMMIT;\n"))
        self.assertLess(sql.index("pg_control_system()"), sql.index("INSERT INTO"))
        for safeguard in ("not empty", "active scheduled jobs", "application triggers", "EXCEPT ALL", "row count differs", "ACCESS EXCLUSIVE"):
            self.assertIn(safeguard, sql)
        self.assertNotIn("TRUNCATE", sql)
        self.assertNotIn("DISABLE TRIGGER", sql)
        self.assertNotIn("service_role", sql)

    def test_backup_coverage_and_column_names_are_checked(self):
        data = self.complete_data()
        del data["drawdown_alerts"]
        with self.assertRaisesRegex(ValueError, "drawdown_alerts"):
            validate_restore_data(data)
        data = self.complete_data()
        data["audit_log"] = [{"id); DELETE": "x"}]
        with self.assertRaisesRegex(ValueError, "column name"):
            validate_restore_data(data)
        data["audit_log"] = [{"id": "a"}, {"id": "b", "action": "add"}]
        with self.assertRaisesRegex(ValueError, "Inconsistent"):
            validate_restore_data(data)

    def test_quote_and_unicode_content_remain_json_data(self):
        data = self.complete_data()
        data["audit_log"] = [{"notes": "Benji's value £100; DROP TABLE public.pension_values;"}]
        sql = build_restore_sql(data, TARGET, SYSTEM_ID)
        self.assertIn("Benji''s value \\u00a3100", sql)
        self.assertIn("jsonb_populate_recordset", sql)
        self.assertIn("format('%I', key)", sql)

    def test_sql_is_private_and_cannot_overwrite_an_existing_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "restore.sql"
            write_private_sql(path, "test")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                write_private_sql(path, "replacement")

    def test_schema_includes_explicit_backup_grant_but_not_jobs_or_audit_triggers(self):
        sql = build_schema_sql(TARGET, SYSTEM_ID)
        self.assertIn("grant select on public.audit_log to service_role", sql)
        self.assertIn("public.drawdown_alert_receipts", sql)
        self.assertIn("SET LOCAL search_path = public, extensions", sql)
        self.assertNotIn("cron.schedule", sql)
        self.assertNotIn("portfolio_activity_trigger", sql)
        self.assertNotIn("drop policy", sql)

    def test_api_apply_fails_before_reading_backup_or_credentials(self):
        script = Path(__file__).resolve().parents[1] / "tools" / "portfolio_restore.py"
        result = subprocess.run([sys.executable, str(script), "/not/a/backup", "--apply"], capture_output=True, text=True, env={**os.environ, "SUPABASE_URL": "https://should-not-be-used.example"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Direct API restores are disabled", result.stderr)

    def test_missing_and_unsafe_manifest_checksums_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            write_backup_files(directory, self.complete_data(), "2026-10-20")
            path = directory / "backup-manifest.json"
            manifest = json.loads(path.read_text())
            original = dict(manifest["files"])
            del manifest["files"]["portfolio-backup.json"]
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "required checksums"):
                verify_backup_directory(directory)
            manifest["files"] = {**original, "../outside": "anything"}
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "unsafe file path"):
                verify_backup_directory(directory)


if __name__ == "__main__":
    unittest.main()
