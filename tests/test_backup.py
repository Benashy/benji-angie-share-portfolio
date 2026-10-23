import json
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import io
import os
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from portfolio_dropbox_backup import TABLES, atomic_text_writer, atomic_write_text, file_sha256, local_successful_backup_today, refresh_latest_copy, verify_backup_directory, write_backup_files
import portfolio_dropbox_backup as backup_module


class BackupTests(unittest.TestCase):
    def test_large_backup_is_complete_and_verifiable(self):
        data = {
            "portfolio_transactions": [{"id": str(index), "amount_gbp": index} for index in range(1205)],
            "audit_log": [{"id": "audit-1"}],
        }
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            manifest = write_backup_files(directory, data, "19-08-2026 09:00 BST")
            verified = verify_backup_directory(directory)
            self.assertEqual(manifest["tables"]["portfolio_transactions"], 1205)
            self.assertEqual(verified["tables"], manifest["tables"])

    def test_checksum_detects_corruption(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            write_backup_files(directory, {"portfolio_transactions": [{"id": "1"}]}, "19-08-2026 09:00 BST")
            backup = directory / "portfolio-backup.json"
            backup.write_text(json.dumps({"portfolio_transactions": []}), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "table counts|checksum"):
                verify_backup_directory(directory)

    def test_scheduled_marker_cannot_hide_missing_new_tables(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            backup = root / "dated"
            write_backup_files(backup, {"portfolio_transactions": []}, "2026-10-20")
            marker = root / "last-successful-backup.json"
            marker.write_text(json.dumps({"date": "2026-10-20", "daily_backup": str(backup)}))
            self.assertFalse(local_successful_backup_today(marker, "2026-10-20"))
            write_backup_files(backup, {table: [] for table in TABLES}, "2026-10-20")
            self.assertTrue(local_successful_backup_today(marker, "2026-10-20"))

    def test_atomic_write_replaces_readonly_existing_file_privately(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "backup.json"
            path.write_text("old")
            path.chmod(0o400)
            with patch.object(Path, "open", side_effect=AssertionError("Existing file must not be opened for writing")):
                atomic_write_text(path, "complete replacement")
            self.assertEqual(path.read_text(), "complete replacement")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(Path(temp).iterdir()), [path])

    def test_interrupted_write_preserves_previous_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "backup.json"
            path.write_text("old verified backup")
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                with atomic_text_writer(path) as file:
                    file.write("partial")
                    raise RuntimeError("interrupted")
            self.assertEqual(path.read_text(), "old verified backup")
            self.assertEqual(list(Path(temp).iterdir()), [path])

    def test_failed_replace_preserves_previous_file_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "backup.json"
            path.write_text("old verified backup")
            with patch("portfolio_dropbox_backup.os.replace", side_effect=PermissionError("simulated provider refusal")):
                with self.assertRaises(PermissionError): atomic_write_text(path, "new")
            self.assertEqual(path.read_text(), "old verified backup")
            self.assertEqual(list(Path(temp).iterdir()), [path])

    def test_entire_latest_copy_can_refresh_twice_without_direct_truncation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = {table: [] for table in TABLES}
            write_backup_files(root, data, "first")
            for path in root.iterdir(): path.chmod(0o400)
            data["app_members"] = [{"user_id": "fixture-one"}]
            write_backup_files(root, data, "second")
            manifest = verify_backup_directory(root, required_tables=TABLES)
            self.assertEqual(manifest["tables"]["app_members"], 1)
            self.assertEqual(manifest["created_at"], "second")

    def test_latest_copy_preserves_every_verified_byte_and_dated_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, target = root / "dated", root / "latest"
            data = {table: [] for table in TABLES}
            data["app_status"] = [{"key": "fixture", "value": {"z": 1, "a": {"second": 2, "first": 1}}}]
            manifest = write_backup_files(source, data, "22-10-2026")
            files = [*manifest["files"], "backup-manifest.json"]
            before = {name: file_sha256(source / name) for name in files}
            result = refresh_latest_copy(source, target)
            self.assertEqual(result, manifest)
            self.assertEqual(before, {name: file_sha256(source / name) for name in files})
            self.assertEqual(before, {name: file_sha256(target / name) for name in files})

    def test_unverified_source_cannot_replace_a_good_latest_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, target = root / "dated", root / "latest"
            data = {table: [] for table in TABLES}
            write_backup_files(source, data, "22-10-2026")
            write_backup_files(target, data, "21-10-2026")
            original = (target / "portfolio-backup.json").read_bytes()
            (source / "portfolio-backup.json").write_text("damaged")
            with self.assertRaises((RuntimeError, json.JSONDecodeError)):
                refresh_latest_copy(source, target)
            self.assertEqual((target / "portfolio-backup.json").read_bytes(), original)
            self.assertEqual(verify_backup_directory(target)["created_at"], "21-10-2026")

    def test_overlapping_source_and_target_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "dated"
            for target in (source, source / "nested", Path(temp)):
                with self.assertRaises(ValueError): refresh_latest_copy(source, target)

    def test_file_provider_refusal_republishes_verified_folder_and_keeps_old_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source, target = root / "dated", root / "latest-scheduled"
            data = {table: [] for table in TABLES}
            write_backup_files(target, data, "old")
            write_backup_files(source, data, "new")
            original_write = backup_module.atomic_write_text
            def refuse_existing_folder(path, text, **kwargs):
                if path.parent == target:
                    raise PermissionError("simulated File Provider refusal")
                return original_write(path, text, **kwargs)
            with patch.object(backup_module, "atomic_write_text", side_effect=refuse_existing_folder), redirect_stdout(io.StringIO()):
                result = refresh_latest_copy(source, target)
            self.assertEqual(result["created_at"], "new")
            previous = list((root / "latest-copy-repair-history").iterdir())
            self.assertEqual(len(previous), 1)
            self.assertEqual(verify_backup_directory(previous[0])["created_at"], "old")
            self.assertEqual(verify_backup_directory(source)["created_at"], "new")
            self.assertFalse(list(root.glob(".latest-scheduled-incoming-*")))

    def test_failed_folder_publication_restores_previous_copy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            source, target = root / "dated", root / "latest-scheduled"
            data = {table: [] for table in TABLES}
            write_backup_files(target, data, "old")
            write_backup_files(source, data, "new")
            original_write, original_rename = backup_module.atomic_write_text, backup_module.os.rename
            def refuse_existing_folder(path, text, **kwargs):
                if path.parent == target:
                    raise PermissionError("simulated file refusal")
                return original_write(path, text, **kwargs)
            def refuse_publication(source_path, target_path):
                if Path(source_path).name.startswith(".latest-scheduled-incoming-"):
                    raise PermissionError("simulated folder publication refusal")
                return original_rename(source_path, target_path)
            with patch.object(backup_module, "atomic_write_text", side_effect=refuse_existing_folder), patch.object(backup_module.os, "rename", side_effect=refuse_publication):
                with self.assertRaises(PermissionError): refresh_latest_copy(source, target)
            self.assertEqual(verify_backup_directory(target)["created_at"], "old")
            self.assertFalse(list(root.glob(".latest-scheduled-incoming-*")))

    def scheduled_fixture(self, root):
        source = root / "daily/2026-10-23-0000"
        data = {table: [] for table in TABLES}
        write_backup_files(source, data, "23-10-2026 00:00 WEST")
        backup_module.write_success_marker(source, datetime(2026, 10, 23, tzinfo=timezone.utc), source)
        return source

    def test_scheduled_skip_repairs_stale_latest_without_download_or_live_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.scheduled_fixture(root)
            argv = ["backup", "--backup-dir", str(root), "--env-file", str(root / "unused.env"), "--skip-if-today"]
            output = io.StringIO()
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv), patch.object(backup_module, "load_env"), patch.object(backup_module, "datetime") as clock, patch.object(backup_module, "fetch_all_tables", side_effect=AssertionError("Network forbidden")), patch.object(backup_module, "upsert_app_status", side_effect=AssertionError("Live write forbidden")), redirect_stdout(output):
                clock.now.return_value = datetime(2026, 10, 23, 8, tzinfo=timezone.utc)
                self.assertEqual(backup_module.main(), 0)
                self.assertEqual(backup_module.main(), 0)
            self.assertTrue(backup_module.latest_copy_matches(source, root / "latest-scheduled"))
            self.assertIn("repaired and verified", output.getvalue())
            self.assertIn("both verified", output.getvalue())

    def test_failed_copy_is_retried_despite_valid_daily_success_marker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.scheduled_fixture(root)
            argv = ["backup", "--backup-dir", str(root), "--skip-if-today"]
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv), patch.object(backup_module, "load_env"), patch.object(backup_module, "datetime") as clock, patch.object(backup_module, "refresh_latest_copy", side_effect=PermissionError("still blocked")) as refresh, patch.object(backup_module, "fetch_all_tables", side_effect=AssertionError("Network forbidden")), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                clock.now.return_value = datetime(2026, 10, 23, 8, tzinfo=timezone.utc)
                self.assertEqual(backup_module.main(), 1)
                self.assertEqual(backup_module.main(), 1)
            self.assertEqual(refresh.call_count, 2)

    def test_offline_repair_does_not_read_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.scheduled_fixture(root)
            argv = ["backup", "--backup-dir", str(root), "--repair-latest"]
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv), patch.object(backup_module, "load_env", side_effect=AssertionError("Credentials forbidden")), patch.object(backup_module, "fetch_all_tables", side_effect=AssertionError("Network forbidden")), patch.object(backup_module, "upsert_app_status", side_effect=AssertionError("Live write forbidden")), redirect_stdout(io.StringIO()):
                self.assertEqual(backup_module.main(), 0)
            self.assertTrue(backup_module.latest_copy_matches(source, root / "latest-scheduled"))

    def test_saved_backup_permission_failure_never_falls_through_to_live_download(self):
        for mode in ("--skip-if-today", "--repair-latest"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                self.scheduled_fixture(root)
                argv = ["backup", "--backup-dir", str(root), mode]
                with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv), patch.object(backup_module, "load_env"), patch.object(backup_module, "verify_backup_directory", side_effect=PermissionError("simulated saved-backup refusal")), patch.object(backup_module, "datetime") as clock, patch.object(backup_module, "fetch_all_tables", side_effect=AssertionError("Network forbidden")), patch.object(backup_module, "upsert_app_status", side_effect=AssertionError("Live write forbidden")), redirect_stderr(io.StringIO()) as error:
                    clock.now.return_value = datetime(2026, 10, 23, 8, tzinfo=timezone.utc)
                    self.assertEqual(backup_module.main(), 1)
                self.assertIn("No download or live status update was attempted", error.getvalue())

    def test_scheduled_marker_avoids_file_provider_directory_listing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.scheduled_fixture(root)
            backup_module.write_success_marker(root, datetime(2026, 10, 23, tzinfo=timezone.utc), source)
            argv = ["backup", "--backup-dir", str(root), "--env-file", str(root / "private.env"), "--skip-if-today"]
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv), patch.object(backup_module, "load_env"), patch.object(backup_module, "newest_complete_daily_backup", side_effect=AssertionError("Directory listing forbidden")), patch.object(backup_module, "fetch_all_tables", side_effect=AssertionError("Network forbidden")), patch.object(backup_module, "upsert_app_status", side_effect=AssertionError("Live write forbidden")), patch.object(backup_module, "datetime") as clock, redirect_stdout(io.StringIO()):
                clock.now.return_value = datetime(2026, 10, 23, 8, tzinfo=timezone.utc)
                self.assertEqual(backup_module.main(), 0)
                self.assertEqual(backup_module.main(), 0)
            self.assertTrue(backup_module.latest_copy_matches(source, root / "latest-scheduled"))

    def test_marker_cannot_redirect_repair_outside_daily_backup_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.scheduled_fixture(root)
            marker = root / "marker.json"
            marker.write_text(json.dumps({"date": "2026-10-23", "daily_backup": str(source)}))
            self.assertEqual(backup_module.verified_daily_from_marker(marker, root, "2026-10-23"), source)
            self.assertIsNone(backup_module.verified_daily_from_marker(marker, root, "2026-10-24"))
            marker.write_text(json.dumps({"date": "2026-10-23", "daily_backup": str(root / "2026-10-23-other")}))
            self.assertIsNone(backup_module.verified_daily_from_marker(marker, root, "2026-10-23"))


if __name__ == "__main__":
    unittest.main()
