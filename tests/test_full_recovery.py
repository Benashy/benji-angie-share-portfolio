import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
AVAILABLE = all(importlib.util.find_spec(name) for name in ("cryptography", "pgpy"))
if AVAILABLE:
    import portfolio_full_recovery as recovery
    from cryptography.fernet import Fernet, InvalidToken


@unittest.skipUnless(AVAILABLE, "Full-recovery extras not installed; see tools/recovery-requirements.txt")
class FullRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.project = "a" * 20
        self.system = "1234567890123456789"
        self.snapshot = {
            "source_project":recovery.PRODUCTION_PROJECT_REF,
            "portfolio":{table:[] for table in recovery.TABLE_ORDER},
            "auth_users":[{"id":"one", "email":"one@example.invalid", "encrypted_password":"hash-one"}, {"id":"two", "email":"two@example.invalid", "encrypted_password":"hash-two"}],
            "auth_identities":[{"user_id":"one", "provider":"email", "identity_data":{"email":"one@example.invalid"}}, {"user_id":"two", "provider":"email", "identity_data":{"email":"two@example.invalid"}}],
            "verified_mfa":0,"non_email_identities":0,"storage_objects":0,"storage_buckets":0,
            "jobs":[{"name":name,"schedule":"0 12 * * *","command":f"select net.http_post(url := 'https://{recovery.PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/test');","active":True} for name in recovery.EXPECTED_JOBS],
        }
        self.snapshot["portfolio"]["app_members"]=[{"user_id":"one"},{"user_id":"two"}]

    def test_valid_snapshot(self):
        recovery.validate_snapshot(self.snapshot)

    def test_missing_identity_rejected(self):
        self.snapshot["auth_identities"].pop()
        with self.assertRaises(ValueError): recovery.validate_snapshot(self.snapshot)

    def test_mfa_not_silently_lost(self):
        self.snapshot["verified_mfa"]=1
        with self.assertRaises(ValueError): recovery.validate_snapshot(self.snapshot)

    def test_files_not_silently_lost(self):
        self.snapshot["storage_objects"]=1
        with self.assertRaises(ValueError): recovery.validate_snapshot(self.snapshot)

    def test_auth_sql_blocks_production(self):
        with self.assertRaises(ValueError): recovery.auth_restore_sql(self.snapshot,recovery.PRODUCTION_PROJECT_REF,self.system)

    def test_auth_sql_preserves_hashes_without_sessions(self):
        sql=recovery.auth_restore_sql(self.snapshot,self.project,self.system)
        self.assertIn("hash-one",sql)
        self.assertNotIn("INSERT INTO auth.sessions",sql)
        self.assertIn("Auth recovery requires an empty target",sql)

    def test_test_logins_scrub_only_copy(self):
        sql=recovery.auth_restore_sql(self.snapshot,self.project,self.system,"test-password")
        self.assertNotIn("hash-one",sql)
        self.assertIn("recovery-one@example.invalid",sql)
        self.assertEqual(self.snapshot["auth_users"][0]["encrypted_password"],"hash-one")

    def test_auth_generated_columns_are_not_inserted(self):
        for user in self.snapshot["auth_users"]: user["confirmed_at"]="generated"
        for identity in self.snapshot["auth_identities"]: identity["email"]="generated"
        sql=recovery.auth_restore_sql(self.snapshot,self.project,self.system)
        self.assertNotIn('"confirmed_at"',sql)
        self.assertNotIn('"email"',sql.split("INSERT INTO auth.identities")[1].split("SELECT")[0])

    def test_schedules_are_atomic_and_inactive(self):
        sql=recovery.schedule_restore_sql(self.snapshot,self.project,self.system)
        self.assertNotIn(recovery.PRODUCTION_PROJECT_REF,sql)
        self.assertEqual(sql.count("active := false"),3)
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))

    def test_service_secret_is_regenerated(self):
        sql=recovery.service_restore_sql(self.project,self.system)
        self.assertIn("gen_random_bytes(32)",sql)
        self.assertIn("FROM PUBLIC,anon,authenticated",sql)

    def test_integrity_setup_does_not_remove_objects(self):
        sql=recovery.integrity_restore_sql(self.project,self.system)
        self.assertNotIn("drop trigger",sql.lower())
        self.assertNotIn("drop constraint",sql.lower())
        self.assertIn("fresh recovery schema",sql)

    def test_encryption_tamper_and_wrong_key(self):
        key=Fernet.generate_key()
        encrypted=recovery.seal({"hello":"private"},key)
        self.assertNotIn(b"private",encrypted)
        with self.assertRaises(InvalidToken): Fernet(Fernet.generate_key()).decrypt(encrypted)
        corrupted=bytearray(encrypted);corrupted[60]^=1
        with self.assertRaises(InvalidToken): Fernet(key).decrypt(bytes(corrupted))

    def test_private_files_cannot_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"secret"
            recovery.private_write(path,b"secret")
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
            with self.assertRaises(FileExistsError): recovery.private_write(path,b"other")

    def test_no_telegram_send_in_completion(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        import hashlib
        responses=[{"ok":True,"result":{"username":recovery.BOT_NAME}},{"smtp_host":None},[{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","digest":hashlib.sha256(token.encode()).hexdigest()}]]
        with patch.object(recovery,"http_json",side_effect=responses) as request:
            result=recovery.complete_kit({"pending":[],"secrets":{}},token,"temporary-management-token")
        self.assertTrue(all("sendMessage" not in call.args[0] for call in request.call_args_list))
        self.assertNotIn("temporary-management-token",json.dumps(result))
        self.assertEqual(result["pending"],["external_account_recovery_codes"])

    def test_wrong_bot_token_not_accepted(self):
        with patch.object(recovery,"http_json",return_value={"ok":True,"result":{"username":"other"}}):
            with self.assertRaises(ValueError): recovery.complete_kit({},"123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ","token")

    def test_test_function_blocks_telegram_and_production(self):
        files=recovery.recovery_test_function([{"name":"index.ts","content":"Deno.serve(async()=>Response.json({}));"}],self.project,"X"*32,[])
        self.assertIn("recovery_external_messages:0",files[0]["content"])
        self.assertIn("blocked an unexpected outbound destination",files[0]["content"])
        self.assertIn("__captured++",files[0]["content"])

    def test_no_archive_path_traversal(self):
        archive=io.BytesIO()
        with tarfile.open(fileobj=archive,mode="w") as tar:
            entry=tarfile.TarInfo("../escape");entry.size=4;tar.addfile(entry,io.BytesIO(b"test"))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): recovery.extract_source({"source_tar":base64.b64encode(archive.getvalue()).decode()},Path(directory)/"out")


if __name__ == "__main__": unittest.main()
