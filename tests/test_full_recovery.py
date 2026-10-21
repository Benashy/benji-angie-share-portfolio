import base64
import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

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
        self.bot={"ok":True,"result":{"id":123456789,"is_bot":True,"username":"PortfolioFixtureBot"}}

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
        responses=[self.bot,{"smtp_host":None},[{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":hashlib.sha256(token.encode()).hexdigest()}]]
        with patch.object(recovery,"http_json",side_effect=responses) as request:
            result=recovery.complete_kit({"pending":[],"secrets":{}},token,"temporary-management-token")
        self.assertTrue(all("sendMessage" not in call.args[0] for call in request.call_args_list))
        self.assertNotIn("temporary-management-token",json.dumps(result))
        self.assertEqual(result["pending"],["external_account_recovery_codes"])

    def test_current_and_legacy_secret_fingerprint_fields(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        fingerprint=hashlib.sha256(token.encode()).hexdigest()
        for fields in ({"value":fingerprint},{"digest":fingerprint},{"value":fingerprint.upper()},{"value":fingerprint,"digest":fingerprint}):
            with self.subTest(fields=list(fields)):
                recovery.verify_bot_secret([{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN",**fields}],token)

    def test_invalid_secret_metadata_fails_closed_without_disclosing_tokens(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        row={"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":hashlib.sha256(token.encode()).hexdigest()}
        examples=[None,{},[None],[],[row,row],[{"name":"another-secret","value":row["value"]}],
                  [{"name":row["name"]}],[{**row,"value":token}],[{**row,"value":"0"*64}],
                  [{**row,"digest":"0"*64}],[{**row,"value":123}]]
        for metadata in examples:
            with self.subTest(metadata_type=type(metadata).__name__):
                with self.assertRaises(recovery.RecoveryCheckError) as caught:
                    recovery.verify_bot_secret(metadata,token)
                self.assertNotIn(token,str(caught.exception))
                self.assertNotIn(row["value"],str(caught.exception))

    def test_invalid_inputs_do_not_make_network_requests(self):
        for bot,management in (("copied surrounding text","test-management"),("123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345","")):
            with patch.object(recovery,"http_json") as request:
                with self.assertRaises(recovery.RecoveryCheckError): recovery.complete_kit({},bot,management)
            request.assert_not_called()

    def test_completion_progress_is_credential_free_and_payload_is_not_mutated(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        original={"pending":["auth_configuration","telegram_bot_token"],"secrets":{}}
        before=copy.deepcopy(original)
        messages=[]
        responses=[self.bot, {"smtp_host":None},
                   [{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":hashlib.sha256(token.encode()).hexdigest()}]]
        with patch.object(recovery,"http_json",side_effect=responses):
            result=recovery.complete_kit(original,token,"private-management-token",progress=messages.append)
        self.assertEqual(original,before)
        self.assertEqual(len(messages),4)
        self.assertNotIn(token," ".join(messages))
        self.assertNotIn("private-management-token",json.dumps(result))

    def test_unexpected_auth_response_and_missing_smtp_password_are_explained(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        metadata=[{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":hashlib.sha256(token.encode()).hexdigest()}]
        for auth in ({},[],{"smtp_host":"smtp.example.invalid","smtp_pass":"********"},
                     {"smtp_host":"smtp.example.invalid","smtp_pass":None}):
            responses=[self.bot,auth,metadata]
            with patch.object(recovery,"http_json",side_effect=responses):
                with self.assertRaises(recovery.RecoveryCheckError) as caught:
                    recovery.complete_kit({"pending":[],"secrets":{}},token,"private-management-token")
            self.assertNotIn(token,str(caught.exception))

    def test_network_errors_show_safe_explanations(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        url=f"https://api.telegram.org/bot{token}/getMe"
        errors=[HTTPError(url,401,token,{},io.BytesIO(token.encode())),URLError(token),TimeoutError(token)]
        for error in errors:
            with patch.object(recovery,"urlopen",side_effect=error):
                with self.assertRaises(recovery.RecoveryCheckError) as caught: recovery.http_json(url)
            self.assertNotIn(token,str(caught.exception))
            self.assertNotIn(url,str(caught.exception))

    def test_cli_displays_only_controlled_error_details(self):
        cases=[(recovery.RecoveryCheckError("The Telegram token format was not recognised."),"format was not recognised"),
               (ValueError("private-credential-must-not-appear"),"ValueError"),
               (KeyboardInterrupt(),"cancelled")]
        for error,expected in cases:
            output=io.StringIO()
            with patch.object(recovery,"main",side_effect=error),redirect_stderr(output):
                self.assertEqual(recovery.run_cli(),1)
            self.assertIn(expected,output.getvalue())
            self.assertNotIn("private-credential-must-not-appear",output.getvalue())

    def test_complete_cli_writes_and_verifies_encrypted_kit(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        management="private-management-test-token"
        source=b"recovery-source-test"
        payload={"format":recovery.FORMAT,"snapshot":self.snapshot,"source_tar":base64.b64encode(source).decode(),
                 "source_sha256":hashlib.sha256(source).hexdigest(),"pending":["telegram_bot_token"],"secrets":{}}
        responses=[self.bot,{"smtp_host":None},
                   [{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":hashlib.sha256(token.encode()).hexdigest()}]]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            key=Fernet.generate_key()
            recovery.private_write(root/"key",key)
            recovery.private_write(root/"original.pfk",recovery.seal(payload,key))
            argv=["recovery","complete","--key-file",str(root/"key"),"--kit",str(root/"original.pfk"),"--output",str(root/"complete.pfk")]
            output=io.StringIO()
            with patch.object(sys,"argv",argv),patch("getpass.getpass",side_effect=[token,management]),patch.object(recovery,"http_json",side_effect=responses),redirect_stdout(output):
                self.assertEqual(recovery.run_cli(),0)
            restored=recovery.open_kit(root/"complete.pfk",key)
            self.assertEqual(restored["secrets"]["PORTFOLIO_TELEGRAM_BOT_TOKEN"],token)
            self.assertEqual(restored["telegram_bot_identity"],{"id":123456789,"username":"PortfolioFixtureBot"})
            self.assertEqual(restored["pending"],["external_account_recovery_codes"])
            self.assertNotIn(token.encode(),(root/"complete.pfk").read_bytes())
            self.assertNotIn(management,json.dumps(restored))
            self.assertNotIn(token,output.getvalue())
            self.assertNotIn(management,output.getvalue())
            self.assertIn("saved and verified",output.getvalue())
            self.assertEqual((root/"complete.pfk").stat().st_mode & 0o777,0o600)
            self.assertEqual(recovery.open_kit(root/"original.pfk",key)["pending"],["telegram_bot_token"])

    def test_bot_name_does_not_override_deployed_token_verification(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        fingerprint=hashlib.sha256(token.encode()).hexdigest()
        for name in ("PortfolioFixtureBot","RenamedPortfolioBot","SharePortfolioReminderBot"):
            with self.subTest(name=name):
                bot=copy.deepcopy(self.bot)
                bot["result"]["username"]=name
                responses=[bot,{"smtp_host":None},[{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":fingerprint}]]
                messages=[]
                with patch.object(recovery,"http_json",side_effect=responses):
                    result=recovery.complete_kit({"pending":[],"secrets":{}},token,"test-management",progress=messages.append)
                self.assertEqual(result["telegram_bot_identity"]["username"],name)
                self.assertIn(f"@{name}"," ".join(messages))

    def test_familiar_bot_name_cannot_bypass_a_wrong_deployed_token(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        bot=copy.deepcopy(self.bot)
        bot["result"]["username"]="SharePortfolioReminderBot"
        original={"pending":["telegram_bot_token"],"secrets":{}}
        responses=[bot,{"smtp_host":None},[{"name":"PORTFOLIO_TELEGRAM_BOT_TOKEN","value":"0"*64}]]
        with patch.object(recovery,"http_json",side_effect=responses):
            with self.assertRaisesRegex(recovery.RecoveryCheckError,"does not match the one deployed"):
                recovery.complete_kit(original,token,"test-management")
        self.assertEqual(original,{"pending":["telegram_bot_token"],"secrets":{}})

    def test_invalid_bot_identity_is_not_used_or_printed(self):
        token="123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345"
        examples=[None,[],{"ok":False},{"ok":True,"result":None},
                  {"ok":True,"result":{"id":1,"is_bot":False,"username":"HumanUser"}},
                  {"ok":True,"result":{"id":True,"is_bot":True,"username":"ValidName"}},
                  {"ok":True,"result":{"id":-1,"is_bot":True,"username":"ValidName"}},
                  {"ok":True,"result":{"id":1,"is_bot":True,"username":token}},
                  {"ok":True,"result":{"id":1,"is_bot":True,"username":"name\nprivate-data"}}]
        for bot in examples:
            messages=[]
            with patch.object(recovery,"http_json",return_value=bot) as request:
                with self.assertRaises(recovery.RecoveryCheckError) as caught:
                    recovery.complete_kit({},token,"test-management",progress=messages.append)
            self.assertEqual(request.call_count,1)
            self.assertNotIn(token," ".join(messages)+str(caught.exception))

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
