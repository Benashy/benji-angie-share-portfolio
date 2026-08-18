# Portfolio Project To-Do

## Security Review

Status: Deferred. Requires Ben's separate approval before implementation.

- Review every Supabase table and Row Level Security policy to confirm that only Benji and Angie can read or change portfolio data.
- Verify that unauthenticated visitors cannot access live portfolio records through the Supabase Data API, Realtime channels or Edge Functions.
- Review the `refresh-prices` and `portfolio-telegram-reports` Edge Functions, including JWT requirements, scheduler authentication, request validation and rate limiting.
- Confirm that Supabase service-role keys, Telegram credentials, GitHub tokens and backup credentials are absent from browser code and GitHub history.
- Review Supabase Auth session duration, password and magic-link behaviour, sign-out handling and account recovery for a private two-person app.
- Review GitHub repository visibility and deployment exposure, separating public website assets from private operational material where appropriate.
- Check the Mac backup secret file and scheduled backup process for minimum permissions, secure storage and safe key rotation.
- Add a Content Security Policy and other practical browser protections where GitHub Pages permits them, without breaking Supabase or Telegram functionality.
- Test the app as an unauthenticated visitor and as each authorised user, including attempted cross-user, direct API and deleted-record access.
- Document a proportionate incident and access-recovery procedure covering a lost device, compromised password, leaked token or departing service provider.

Before any security changes are applied, take and verify a fresh Dropbox backup, record the current policies and function settings, and agree a rollback plan.
