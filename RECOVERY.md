# Portfolio Recovery

## What Is Backed Up

- GitHub stores the website code and deployment history.
- Supabase stores the live portfolio database.
- Dropbox stores independent dated exports of every portfolio table.

Each new Dropbox backup includes row counts and SHA-256 checksums. The backup is only marked successful after those checks pass.

## Verify A Backup

Run `tools/portfolio_restore.py` with the dated backup folder. Verification is the default and makes no database changes.

The tool checks:

- the backup manifest and format
- every table row count
- every recorded file checksum

## Restore

Restoration is deliberately separate from verification. It only upserts records and does not delete database rows absent from the backup.

Before applying a restore:

1. Confirm the target Supabase project.
2. Take a fresh export of the current target.
3. Verify the selected Dropbox backup.
4. Read the reported table counts.
5. Use the explicit restore confirmation phrase printed by the tool.
6. Compare post-restore table counts and portfolio totals with the backup summary.

The authentication users must already exist in the target project before restoring rows that refer to them.

## Scheduled Backup

The Mac schedule tries when loaded, hourly and at the stated clock times. Once one verified backup succeeds in a calendar day, later attempts skip. The website does not need to be open, but the Mac must be on and connected to the internet for a backup attempt to succeed.
