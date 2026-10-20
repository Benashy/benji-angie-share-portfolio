# Portfolio Recovery

## What Is Backed Up

- GitHub stores the website code and deployment history.
- Supabase stores the live portfolio database.
- Dropbox stores independent dated exports of every portfolio table.

Each new Dropbox backup includes row counts and SHA-256 checksums. The backup is only marked successful after those checks pass.

## Verify A Backup

Run `tools/portfolio_restore.py` with the dated backup folder. Verification is the default and makes no database connections or changes. It never reads the backup credential.

The tool checks:

- the backup manifest and format
- every table row count
- every recorded file checksum
- complete coverage of the 19 current portfolio tables

Older snapshots can contain the financial records but omit newer alert tables. Do not silently treat those missing tables as an empty alert history. Take a complete read-only export with `tools/export_recovery_backup.py` where the source is available.

## Restore

Restore into a separate, fresh Supabase project or temporary branch. Do not test against production. The normal backup service retains its existing read-only access to portfolio records; it is never granted restore write permissions.

The old `--apply` API path is disabled. A separately authorised database administrator applies prepared SQL through the Supabase SQL editor or connector. There is no second long-lived restore API key to store or publish.

Before applying a restore:

1. Verify the selected backup and preserve the original files.
2. Create an isolated, data-less target. Do not copy scheduler secrets, enable report jobs, send Telegram messages or change the website configuration.
3. Verify its project reference is not the live portfolio project. Read its physical database identity with `select system_identifier::text from pg_control_system();` through the target's admin connection.
4. Prepare SQL using `--write-schema-sql`, `--write-sql`, `--target-project-ref`, `--target-system-id` and `--confirm PREPARE_ISOLATED_RESTORE_<target-project-ref>`. Output files contain private portfolio data and must stay outside GitHub. They are created with mode 0600 and cannot overwrite an existing file.
5. Apply the prepared schema SQL to the checked empty target. This loads the original table definitions, RLS policies and explicit grants, including audit-log reads for backups. Delta migrations alone cannot build an empty project.
6. Recreate the required authentication user identities in the target. Existing references in the backup must resolve. For a drill, use non-sign-in placeholders with the required IDs. Real recovery needs the actual two user accounts and their sign-in settings, or an explicitly reviewed ID mapping. Passwords, sessions and provider secrets are not in the portfolio backup.
7. Apply the prepared data SQL to that same target. It checks the physical database identity, locks the target tables, refuses non-empty tables or active scheduled jobs, and refuses application triggers. Data and row-by-row verification execute inside one transaction, so any failure rolls back the entire import.
8. Install the reliability/audit migrations after loading data, then the pension audit-field repair. For a fresh target only, redundant `DROP ... IF EXISTS` statements can be omitted after verifying that those triggers and constraints do not exist. Never suppress FK constraints or RLS to work around an import error.
9. Confirm all 19 table counts and typed row contents, portfolio calculations, FK/positive-value constraints, RLS for each member and the backup role's read-only access to financial records. Confirm no extra audit entries were invented during import.
10. Keep a private report of the outcome. Delete only the disposable test branch after verification to stop its compute charges. Never merge that branch, import its settings into production, or point the live website at it.

The generated SQL is tied to the selected physical database instance, not just a typed URL. Executing it against another instance raises an error before any portfolio inserts. It performs INSERT-only recovery into empty tables, never an in-place merge, delete or overwrite of a live ledger.

Restoring the records does not by itself restore the whole hosted app. GitHub supplies the app code and SQL schema. Auth configuration, API/SMTP/Telegram secrets, Edge Functions, schedules and website routing need separate, reviewed setup before switching users to a recovered project. These are not exercised by the data-only recovery drill.

## Scheduled Backup

The Mac schedule tries when loaded, hourly and at the stated clock times. Once one complete, verified 19-table backup succeeds in a calendar day, later attempts skip. A date-only success marker cannot hide an incomplete older snapshot. The website does not need to be open, but the Mac must be on and connected to the internet for a backup attempt to succeed.
