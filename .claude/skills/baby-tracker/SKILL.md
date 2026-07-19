---
name: baby-tracker
description: Working on the baby-tracker PWA (this repo) — architecture, event-type pattern, privacy rules for the public repo, verification and Fly.io deploy workflow. Use for any change to this project.
---

# Baby Tracker — project skill

A self-hosted newborn-tracking PWA two parents use from iPhones. One Node.js
process (Express + better-sqlite3) serves a no-build vanilla-JS frontend,
owns SQLite + photos on a Fly.io volume, and runs a push-notification nudge
timer. No framework, no bundler, no test suite (yet) — verification is manual.

## PRIVACY — read first, applies to every commit

**This repo is public. The family it serves must not be identifiable from it.**

- Never commit: parent/baby names, birth date, emails, phone numbers, the
  shared secret, the Fly app name, or the deployed URL.
- All personal config lives in `.env` (gitignored, exists locally) and Fly
  secrets. The deployed app name is in `fly.toml` (gitignored; template at
  `fly.toml.example`). Read those files locally when you need real values.
- UI copy in committed code must stay gender/name-neutral (personal strings
  are injected at runtime from env: `APP_NAME`, `BABY_NAME`, `USER_NAMES`,
  `BABY_SEX`, `BIRTH_DATE`).
- Before every commit, audit:
  `grep -rniE '<family names, app name, emails, birth year, secret>' --include='*.js' --include='*.md' --include='*.html' ...`
  (use the real values from `.env` as the patterns; expect zero hits in
  committable files) and eyeball `git add -n` output for unexpected files.
- Anonymous requests must never receive personal data: `/api/config` returns
  only `{user:null}` pre-auth, the manifest returns a generic name without a
  login cookie, login is two-step (secret proven → names revealed). Preserve
  these properties when touching auth or adding endpoints.

## Architecture map

- `server/index.js` — all routes. Auth = HMAC-signed cookie (`bt_auth`),
  `requireAuth` middleware; login rate-limited per IP; `/api/export` also
  accepts `Authorization: Bearer <APP_SECRET>` for cron backups.
- `server/db.js` — schema + migrations (run at startup, keyed on
  `PRAGMA table_info` column checks). Plain `ALTER TABLE ADD COLUMN` when
  possible; full table rebuild when the `type` CHECK constraint changes
  (see the height migration for the pattern).
- `server/push.js` — web-push (VAPID) + nudge timer: no feed/diaper event
  for `NUDGE_HOURS` (default 6) → push all subscriptions, re-nudge hourly,
  state in `meta` table.
- `public/app.js` — views (log / timeline / reports / sleep), bottom-sheet
  form builder, hand-rolled SVG charts, CDC growth percentiles (LMS math),
  sleep-interval inference, theme toggle, push subscribe.
- `public/growth-curves.js` — CDC LMS tables, both sexes; table picked at
  runtime from `BABY_SEX`.
- `public/sw.js` — network-first service worker + push/notificationclick.

## Key patterns

- **One `events` table** with nullable type-specific columns. To add an event
  type: db.js migration (type CHECK + column) → `TYPES`, `FIELDS_BY_TYPE`,
  `validateEvent` case in index.js → frontend: log button in index.html,
  sheet branch in `openSheet`, `describe()` case, reports aggregation if
  relevant. The height type (commit history) is the reference example.
- **Timestamps**: stored UTC ISO; day boundaries for reports use `HOME_TZ`
  server-side via `Intl.DateTimeFormat` grouping. All entry times editable.
- **Quick-log UX rule**: diapers save instantly (toast → tap to edit);
  formula sheet pre-fills from the last formula event (server-fetched).
  Preserve the ≤2-taps-at-3am spirit in new logging features.
- **Charts**: inline SVG strings, colors via CSS vars (`--c-*`) with
  validated light/dark values. New chart colors must be validated with the
  dataviz skill's palette validator against BOTH surfaces (`#ffffff` light,
  `#211d2e` dark). Sub-3:1 fills require a table/labels fallback (exists:
  History tab). Series colors follow the entity across charts
  (formula/weight=violet, breastfeed=aqua, pee=yellow, poop=green).
- **Theme**: light/dark via CSS vars; dark block duplicated for the OS media
  query and `data-theme="dark"` override — keep both in sync.
- **Sleep view**: asleep-between-feeds inference; awake overrides stored as
  `awake_after` on the feed event *preceding* the interval. Gaps between
  consecutive feeds of *different* types (breastfeed ↔ formula = one combined
  session) are always awake and not toggleable — explicit parent feedback.

## Local dev & verification

```sh
npm start                 # reads .env; http://localhost:3000; dev secret "baby"
```
- Login via curl for API tests: POST `/api/login` `{secret, user}` with a
  cookie jar; note zsh doesn't word-split `$VAR` — write curl flags out.
- After server-file edits, restart: `pkill -f 'server/index.js'` then re-launch.
- Verify UI in a browser (Chrome MCP tools): coordinate clicks are
  unreliable at scaled DPI — drive handlers with `javascript_tool` instead.
- Local `data/` is disposable dev scratch full of fake test data.
- The login rate limiter (20/15min/IP) will lock you out during repeated
  auth tests — restart the server to reset it.

## Deploy (production is live — parents depend on it)

```sh
export PATH="/opt/homebrew/bin:$PATH"   # flyctl lives here
fly deploy --ha=false                    # app name comes from local fly.toml
curl -s https://<app-url>/api/config     # expect {"user":null} post-deploy
```
- Secrets: `fly secrets set -a <app> --stage KEY=...` then deploy applies them.
- Single machine + volume at `/data` (SQLite + photos). Deploys never touch
  data; migrations run at startup.
- `auto_stop_machines = "off"` is load-bearing (nudge timer must run) — never
  re-enable auto-stop.
- Commit (with the privacy audit) before deploying; push to the GitHub remote.

## Backups (already running — don't break)

- Fly volume snapshots: daily, 30-day retention.
- `GET /api/export` → tar.gz of consistent SQLite copy + photos.
- Daily launchd agent on the dev Mac (`~/Library/LaunchAgents/*backup*.plist`,
  contains the secret, mode 600) pulls to `~/baby-tracker-backups/`, keeps 30.
- If the export path or auth changes, update the plist and re-test with
  `launchctl kickstart`.

## Known gaps (agreed next steps)

1. `/api/health` + Fly http check + external uptime monitor (top priority —
   outages are currently silent).
2. Refresh-on-focus + duplicate-entry warning (two parents, no live sync).
3. API test suite (validation, auth boundaries, reports aggregation, nudge).
4. Optional: store original-resolution photos (currently 1600px only).
