# Scheduled Dropbox Backup Repair

Verified on 23 October 2026 using the existing macOS LaunchAgent
`com.benjiangie.portfolio-backup`, not a foreground substitute.

## Findings and Fix

- The background process could create a dated export but was refused permission
  to replace existing items in `latest-scheduled`. A foreground-only test had not
  exposed this failure.
- The previous daily-success shortcut skipped every later attempt, even while
  the convenience copy remained stale.
- The blocked convenience folder was preserved in `latest-copy-repair-history`.
  The actual background process then created the replacement folder successfully.
- Scheduled runs now verify the saved daily export and convenience copy. A stale
  copy is repaired locally, rather than being skipped or requiring another download.
- The private local success marker provides the verified source path without
  depending on Dropbox directory enumeration. Permission failures stop safely.
- Writes use complete temporary files. A file-level permission failure can use a
  verified staging folder, preserving the previous copy and rolling back a failed
  publication. No blanket permission grants or security-attribute removal were used.

## Actual Runner Evidence

All times below are UK/Lisbon summer time (UTC+1), from the existing scheduled log.

| Time | Actual background result |
| --- | --- |
| 10:49:07 | Dated export `2026-10-23-1048` and `latest-scheduled` completed, exit 0. |
| 10:50:12 | Both copies verified; repeat correctly skipped, exit 0. |
| 10:50:46 | Rebuilt `latest-scheduled` from the saved dated export, exit 0. No download or live status write. |
| 10:51:24 | Both copies verified again; repeat correctly skipped, exit 0. |

Independent verification matched all files and the success marker against the
dated export: **19 tables, 2,928 records**. The original midnight dated export
remained byte-for-byte unchanged. The LaunchAgent definition and its wrapper
were checksum-identical before and after the work; credentials were not edited.

The normal backup-path test read the live database and updated the existing
backup-health status only. It did not edit portfolio records, website code,
logins, functions, Telegram settings or schedules. The subsequent saved-copy
repair and repeat checks did not make live requests. No messages were sent.

Automated verification: **60 Python tests and 41 JavaScript tests passed**.
This verifies the actual runner when invoked now, not a future midnight run or
behaviour while the Mac is powered off. Its hourly and calendar timetable is unchanged.

Source and tests are saved on the recovery branch, separate from live `main`.
