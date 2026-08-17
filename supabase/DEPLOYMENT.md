# Supabase Deployment

This file records the non-secret deployment order for the portfolio app.

## Database

For an existing project, apply SQL files in `supabase/migrations` in filename order. Record each applied filename before deploying browser code that depends on it.

For a new project:

1. Apply `supabase-schema.sql`.
2. Apply the feature setup SQL files in the repository root.
3. Apply every file in `supabase/migrations` in filename order.
4. Verify expected table columns, constraints and triggers before importing data.

## Edge Functions

Deploy these folders with their shared dependency:

- `refresh-prices`, with JWT verification enabled.
- `portfolio-telegram-reports`, retaining its existing scheduler authentication arrangement.
- `_shared/portfolio-core.js` is used by both the browser and Telegram report function.

Required function secrets and authentication settings remain in Supabase. They must never be placed in browser files or committed to GitHub.

## Release Check

1. Run the local automated checks.
2. Apply database migrations.
3. Deploy Edge Functions.
4. Publish GitHub Pages files.
5. Open the force-refresh URL and verify the visible version.
6. Sign in, refresh prices, inspect dashboard totals and test one non-destructive workflow.
7. Confirm GitHub Actions completed successfully.

If any stage fails, stop and fix that stage before continuing. Do not treat a successful upload as proof that the deployed app works.
