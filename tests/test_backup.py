import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from portfolio_dropbox_backup import TABLES, local_successful_backup_today, verify_backup_directory, write_backup_files


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


if __name__ == "__main__":
    unittest.main()
