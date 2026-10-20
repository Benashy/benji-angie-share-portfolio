# Full-App Recovery Kit

The kit is separate from the live application and daily financial exports. Do not
enable recovered schedules, repoint the website, reset real passwords, or deploy
recovery-test adapters into production.

## Contents And Protection

- All 19 portfolio tables, two authentication users and their email identities.
- Original password hashes, not plaintext passwords. No active sessions, refresh
  tokens, outstanding login links or recovery tokens are restored.
- Exact deployed Edge Function files and their JWT verification settings.
- A versioned Git source archive including schema, tests and recovery tools.
- Actual scheduler names, timing and commands, plus Realtime publication metadata.
- After private completion: login configuration, email-service configuration where
  applicable and the verified existing Telegram bot token.

Capture is one read-only database snapshot. Sensitive results are encrypted inside
Postgres with AES-256 OpenPGP before reaching the connector. The portable kit is
then authenticated and encrypted with Fernet. The independent random unlock key
must be stored in a password manager, never in GitHub or beside the Dropbox kit.
Loss of both the Mac and this independent key makes the kit unrecoverable.

`tools/recovery-requirements.txt` pins the recovery reader dependencies. Install
them into a private virtual environment on a replacement machine. The normal
website and existing daily backup do not depend on these packages.

## Completion

`portfolio_full_recovery.py complete` privately requests the existing portfolio
bot token and a project-scoped Supabase management token. It checks `getMe`, the
deployed token digest and reads the Auth configuration. It sends no Telegram
messages, changes no settings and does not retain the management token. It creates
a new encrypted kit rather than overwriting the original. Check the two underlying
users are the only intended accounts and separately preserve platform recovery
codes for GitHub, Supabase, Dropbox and the Telegram bot owner's account.

The complete status must not be claimed while bot credentials, Auth settings or
account-recovery access remain unchecked. MFA, external identity providers and
Storage objects are explicitly rejected rather than silently omitted. If they are
introduced later, extend and retest the kit before calling it complete.

## Isolated Restore

1. Create a fresh, separate project or temporary branch. Read its physical database
   identity and check its project reference is not production.
2. Unlock the kit locally. Use `prepare` with the exact target reference, system
   identity and target publishable key. Preserve originals; use a new directory.
3. Apply the six numbered SQL files in order. Schema and users precede financial
   records; audit/integrity triggers follow them. This avoids invented audit events.
4. Restore creates fresh internal scheduler authentication. All three recovered
   jobs are inactive in the same transaction in which they are created. Verify the
   target URLs refer only to the new project and every job is disabled.
5. Restore target-specific login and email settings using a reviewed Management
   API configuration. Test-site addresses must not redirect to the live website.
   Use fresh platform keys and require a new sign-in. Do not reuse old sessions.
6. Deploy the archived functions and dependencies with their recorded verification
   settings. For a real replacement, set the bot token privately in the new project;
   it is never inserted into public frontend code. For a drill, do not install the
   real bot token at all.
7. Serve the recovered website on a private local test address. Its `config.js`
   must point only to the target database. Verify both accounts, membership RLS,
   totals, costs, ledger, pension editing, market refresh and alert actions.
8. Exercise weekly/monthly precedence, daily snapshots, repeated-run suppression
   and after-close alert delivery using the test adapter. It captures Telegram
   requests in memory, substitutes deterministic market fixtures and blocks
   requests to production. No message reaches Telegram. This is not proof of real
   Telegram delivery or real email delivery, which need separately approved tests.
9. Compare original and recovered portfolio outputs and login password hashes;
   inspect active schedules and original live-data fingerprints. Save a private
   result report, then delete only the disposable target.

## Real Cutover Is A Separate Approval

The archive is not an automatic failover. Before a genuine cutover: pause writes,
take a final consistent snapshot, disable old senders if accessible, verify the new
site and permissions, change website configuration, then enable the new schedules
once. Preserve delivery history to avoid resending past reports. If old senders
cannot be ruled out, rotate the bot token and install it only on the replacement.
Update the Mac backup to the replacement project and take a new verified backup.

## Maintenance

Refresh the kit after changes to logins, email delivery, functions, credentials,
schedules or dependencies. Daily exports continue separately. This kit is a dated
recovery point, not a second automatic daily backup. Preserve an encrypted source
archive independently of GitHub. A future automated kit-refresh process must not
silently store an administrative management token on the routine backup job.
