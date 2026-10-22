from contextlib import redirect_stderr, redirect_stdout
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
AVAILABLE = all(importlib.util.find_spec(name) for name in ("cryptography", "pgpy"))
if AVAILABLE:
    import test_full_recovery as fixtures
    import portfolio_full_recovery as recovery
    import verify_recovery_key as checker
    from cryptography.fernet import Fernet


@unittest.skipUnless(AVAILABLE, "Full-recovery extras not installed")
class RecoveryKeyTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.FullRecoveryTests()
        fixture.setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.key = Fernet.generate_key()
        source = b"verified-source-fixture"
        self.payload = {
            "format": recovery.FORMAT,
            "snapshot": fixture.snapshot,
            "source_tar": recovery.base64.b64encode(source).decode(),
            "source_sha256": recovery.hashlib.sha256(source).hexdigest(),
            "deployed_functions": {name: {} for name in recovery.FUNCTIONS},
            "auth_config": {"smtp_host": None},
            "secrets": {"PORTFOLIO_TELEGRAM_BOT_TOKEN": "private-fixture-token"},
        }
        self.kit = self.root / "completed.pfk"
        recovery.private_write(self.kit, recovery.seal(self.payload, self.key))

    def test_key_unlocks_without_network_or_original_key_file(self):
        original = self.kit.read_bytes()
        with patch.object(recovery, "http_json", side_effect=AssertionError("Network forbidden")), patch.object(recovery, "read_key", side_effect=AssertionError("Original key forbidden")):
            report = checker.check_key(self.kit, self.key)
        self.assertTrue(report["passed"])
        self.assertEqual(report["tables"], 19)
        self.assertEqual(report["login_accounts"], 2)
        self.assertEqual(report["schedules"], 3)
        self.assertEqual(report["server_functions"], 3)
        self.assertEqual(self.kit.read_bytes(), original)
        self.assertNotIn(self.key.decode(), json.dumps(report))
        self.assertNotIn("private-fixture-token", json.dumps(report))
        self.assertEqual(report["network_requests"], 0)

    def test_wrong_or_malformed_key_is_explained_without_disclosure(self):
        for key in (Fernet.generate_key(), b"not-a-key"):
            with self.assertRaises(recovery.RecoveryCheckError) as caught:
                checker.check_key(self.kit, key)
            self.assertNotIn(key.decode(), str(caught.exception))

    def test_tampered_backup_is_rejected(self):
        damaged = bytearray(self.kit.read_bytes())
        damaged[80] ^= 1
        self.kit.write_bytes(damaged)
        with self.assertRaises(recovery.RecoveryCheckError):
            checker.check_key(self.kit, self.key)

    def test_incomplete_kits_are_not_marked_complete(self):
        for field in ("auth_config", "secrets", "deployed_functions"):
            payload = copy.deepcopy(self.payload)
            payload.pop(field)
            candidate = self.root / (field + ".pfk")
            recovery.private_write(candidate, recovery.seal(payload, self.key))
            with self.assertRaises(recovery.RecoveryCheckError):
                checker.check_key(candidate, self.key)

    def test_cli_uses_hidden_input_and_writes_only_a_nonsecret_report(self):
        report_path = self.root / "check.json"
        argv = ["verify", "--kit", str(self.kit), "--report", str(report_path)]
        output = io.StringIO()
        with patch.object(sys, "argv", argv), patch.object(sys.stdin, "isatty", return_value=True), patch.object(checker.getpass, "getpass", return_value=self.key.decode()), redirect_stdout(output):
            self.assertEqual(checker.run_cli(), 0)
        self.assertIn("PASS:", output.getvalue())
        self.assertNotIn(self.key.decode(), output.getvalue() + report_path.read_text())
        self.assertNotIn("private-fixture-token", output.getvalue() + report_path.read_text())
        self.assertEqual(report_path.stat().st_mode & 0o777, 0o600)

    def test_nonterminal_input_is_rejected_before_prompting(self):
        argv = ["verify", "--kit", str(self.kit), "--report", str(self.root / "check.json")]
        with patch.object(sys, "argv", argv), patch.object(sys.stdin, "isatty", return_value=False), patch.object(checker.getpass, "getpass") as prompt, redirect_stderr(io.StringIO()):
            self.assertEqual(checker.run_cli(), 1)
        prompt.assert_not_called()
        self.assertFalse((self.root / "check.json").exists())

    def test_unexpected_errors_do_not_print_private_details(self):
        output = io.StringIO()
        with patch.object(checker, "main", side_effect=ValueError("private-fixture-token")), redirect_stderr(output):
            self.assertEqual(checker.run_cli(), 1)
        self.assertNotIn("private-fixture-token", output.getvalue())


if __name__ == "__main__":
    unittest.main()
