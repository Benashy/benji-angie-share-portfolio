# Benji and Angie's Share Portfolio

Private two-person portfolio dashboard, ledger and Telegram reporting app.

## Architecture

- GitHub Pages serves the static HTML, CSS and JavaScript.
- Supabase stores the live ledger, valuations, prices, snapshots and report history.
- Supabase Edge Functions refresh market data and send Telegram reports.
- An after-close check compares active quoted holdings with their trailing 12-month daily closing high and records threshold alerts at 10%, 15%, 20% and 25%.
- A local Mac schedule exports the full Supabase data set to Dropbox.

## Development

The production-ready checkout is `outputs/portfolio-github`. Run the checks before publishing:

```text
npm test
node --check app.js
python3 -m py_compile tools/portfolio_dropbox_backup.py tools/portfolio_restore.py
```

Every browser release must update `APP_VERSION` in `app.js` and the matching `styles.css` and `app.js` cache markers in `index.html`.

Deployment and recovery instructions are in `supabase/DEPLOYMENT.md` and `RECOVERY.md`.

Do not add private ledger exports, spreadsheets, local backups or secret keys to this repository.

The first drawdown check establishes the baseline without sending a historical breach alert. Subsequent newly crossed levels create one alert per holding and closing date. Each user can review or snooze their own alert for 1, 3, 7 or 28 days; a deeper threshold still creates a new alert.
