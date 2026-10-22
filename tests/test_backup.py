import json
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from portfolio_dropbox_backup import TABLES, atomic_text_writer, atomic_write_text, file_sha256, local_successful_backup_today, refresh_latest_copy, verify_backup_directory, write_backup_files


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


if __name__ == "__main__":
    unittest.main()
