# Baby Tracker

A tiny self-hosted PWA for two parents to track a newborn: breastfeeding,
formula (ml), diapers, weight, and timestamped photos — with day-by-day
reports and a push-notification nudge if nothing has been logged for a while.

One Node.js process serves the app, owns a SQLite database, stores photos on
disk, and runs the nudge checker. No accounts, no third-party services.

## Privacy

This repo is public; **no personal data lives in it**. Names, emails, and the
shared login secret are supplied via environment variables (`.env` locally —
gitignored — or Fly secrets in production). The database and photos live on a
private volume, and photos are only served behind login.

## Local development

```sh
npm install
npm run make-icons   # once, generates public/icons/*.png
npm start            # http://localhost:3000
```

Configuration is read from `.env` (see `.env` keys below). The default login
secret in dev is `baby`.

## Deploying to Fly.io

```sh
cp fly.toml.example fly.toml           # set your app name + region (stays local)
fly apps create your-app-name
fly volumes create data --size 1 --region <region> -a your-app-name
npx web-push generate-vapid-keys       # for push notifications
fly secrets set -a your-app-name \
  APP_SECRET="your-family-secret" \
  USER_NAMES="Mom,Dad" \
  BABY_NAME="..." \
  BIRTH_DATE="YYYY-MM-DD" \
  BABY_SEX="girl" \
  VAPID_SUBJECT="mailto:you@example.com" \
  VAPID_PUBLIC_KEY="..." \
  VAPID_PRIVATE_KEY="..."
fly deploy --ha=false
```

Then on each iPhone: open the app URL in Safari → Share → **Add to Home
Screen** → open it from the home screen → log in → tap 🔔 to enable nudges.

## Backups

Three layers:

1. **Fly volume snapshots** — automatic, daily, 30-day retention
   (`fly volumes update <vol-id> --snapshot-retention 30`). Restore with
   `fly volumes create data --snapshot-id <id>`.
2. **Off-site export** — `GET /api/export` streams a tar.gz of the SQLite
   database + all photos. Authenticated by login cookie or
   `Authorization: Bearer <APP_SECRET>`.
3. **Pull script** — `scripts/backup.sh` downloads an export and keeps the
   newest 30 locally:
   ```sh
   APP_URL=https://your-app.fly.dev APP_SECRET=... ./scripts/backup.sh
   ```
   Run it on a schedule (cron/launchd) for continuous off-site copies.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `APP_SECRET` | `baby` (dev only) | shared login secret — set a real one in prod |
| `USER_NAMES` | `Mom,Dad` | comma-separated parent names shown at login |
| `BABY_NAME` | `Baby` | baby's name (private, env-only) |
| `APP_NAME` | falls back to `BABY_NAME` | app title + home-screen name |
| `BIRTH_DATE` | unset | baby's birth date (YYYY-MM-DD); enables growth percentiles |
| `BABY_SEX` | unset | `boy` or `girl`; selects the CDC growth-curve table |
| `HOME_TZ` | `America/Los_Angeles` | day boundaries for reports |
| `NUDGE_HOURS` | `6` | push a nudge after this many hours with no entries |
| `RENUDGE_MINUTES` | `60` | re-nudge interval while still quiet |
| `DATA_DIR` | `./data` | where SQLite + photos live (`/data` on Fly) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | auto-generated in dev | web-push credentials |
| `COOKIE_SECRET` | derived from `APP_SECRET` | cookie signing key |
