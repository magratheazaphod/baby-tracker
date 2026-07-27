# Baby Tracker

A self-hosted newborn-tracking PWA two parents use from iPhones. One Node.js
process (Express + better-sqlite3) serves a no-build vanilla-JS frontend, owns
SQLite + photos on a Fly.io volume, and runs a push-notification nudge timer.
No framework, no bundler, no test suite (yet) - verification is manual.

Production is live and the parents depend on it.

## PRIVACY - applies to every commit

**This repo is public. The family it serves must not be identifiable from it.**

- Never commit: parent/baby names, birth date, emails, phone numbers, the
  shared secret, the Fly app name, or the deployed URL.
- All personal config lives in `.env` (gitignored, exists locally) and Fly
  secrets. The deployed app name is in `fly.toml` (gitignored; template at
  `fly.toml.example`). Read those files locally when you need real values.
- UI copy in committed code must stay gender/name-neutral (personal strings
  are injected at runtime from env: `APP_NAME`, `BABY_NAME`, `USER_NAMES`,
  `BABY_SEX`, `BIRTH_DATE`).
- Before every commit, audit: grep the tree for the real values from `.env`
  (names, app name, emails, birth year, secret) across `*.js`, `*.md`,
  `*.html` - expect zero hits in committable files - and eyeball `git add -n`
  output for unexpected files.
- Anonymous requests must never receive personal data: `/api/config` returns
  only `{user:null}` pre-auth, the manifest returns a generic name without a
  login cookie, login is two-step (secret proven → names revealed). Preserve
  these properties when touching auth or adding endpoints.
- Anything published (README, issues, demos) must use a fully synthetic
  instance, never the real one - see the `baby-tracker-publishing` skill.

## Workflow

- Work on a branch and open a PR. `main` is what's deployed - never push to it
  directly.
- Deploying and the backup pipeline: `baby-tracker-ops` skill.
- Screenshots, demo data, anything published: `baby-tracker-publishing` skill.
- Agreed next steps: `docs/roadmap.md`.

## Architecture map

- `server/index.js` - all routes. Auth = HMAC-signed cookie (`bt_auth`),
  `requireAuth` middleware; login rate-limited per IP; `/api/export` also
  accepts `Authorization: Bearer <APP_SECRET>` for cron backups.
- `server/db.js` - schema + migrations (run at startup, keyed on
  `PRAGMA table_info` column checks). Plain `ALTER TABLE ADD COLUMN` when
  possible; full table rebuild when the `type` CHECK constraint changes
  (see the height migration for the pattern).
- `server/push.js` - web-push (VAPID) + nudge timer: no feed/diaper event for
  `NUDGE_HOURS` (default 6) → push all subscriptions, re-nudge hourly, state
  in `meta` table.
- `public/app.js` - views (log / timeline / reports / sleep), bottom-sheet
  form builder, hand-rolled SVG charts, WHO growth percentiles (LMS math),
  sleep-interval inference, theme toggle, push subscribe.
- `public/growth-curves.js` - WHO 0-24mo LMS tables (daily resolution early),
  both sexes; table picked at runtime from `BABY_SEX`. WHO (not CDC 2000) is
  deliberate: it's what US pediatricians use under age 2 - parents compare the
  app's percentiles to doctor visits.
- `public/sw.js` - network-first service worker + push/notificationclick.

## Key patterns

- **One `events` table** with nullable type-specific columns. To add an event
  type: db.js migration (type CHECK + column) → `TYPES`, `FIELDS_BY_TYPE`,
  `validateEvent` case in index.js → frontend: log button in index.html, sheet
  branch in `openSheet`, `describe()` case, reports aggregation if relevant.
  The height type (commit history) is the reference example.
- **Timestamps**: stored UTC ISO; day boundaries for reports use `HOME_TZ`
  server-side via `Intl.DateTimeFormat` grouping. All entry times editable.
- **Quick-log UX rule**: diapers save instantly (toast → tap to edit); formula
  sheet pre-fills from the last formula event (server-fetched). Preserve the
  ≤2-taps-at-3am spirit in new logging features.
- **Charts**: inline SVG strings, colors via CSS vars (`--c-*`) with validated
  light/dark values. New chart colors must be validated with the dataviz
  skill's palette validator against BOTH surfaces (`#ffffff` light, `#211d2e`
  dark). Sub-3:1 fills require a table/labels fallback (exists: History tab).
  Series colors follow the entity across charts (formula/weight=violet,
  breastfeed=aqua, pee=yellow, poop=green).
- **Theme**: light/dark via CSS vars; dark block duplicated for the OS media
  query and `data-theme="dark"` override - keep both in sync.
- **Sleep view**: asleep-between-feeds inference; awake overrides stored as
  `awake_after` on the feed event *preceding* the interval. A formula feed
  within 1h after a breastfeed is a top-up (they always breastfeed first,
  supplement if needed): that gap is always awake and not toggleable -
  explicit parent feedback. Other gaps default asleep, tap to flip.

## Local dev & verification

```sh
npm start                 # reads .env; http://localhost:3000; dev secret "baby"
```
- Login via curl for API tests: POST `/api/login` `{secret, user}` with a
  cookie jar; note zsh doesn't word-split `$VAR` - write curl flags out.
- After server-file edits, restart: `pkill -f 'server/index.js'` then re-launch.
- Verify UI in a browser (Chrome MCP tools): coordinate clicks are unreliable
  at scaled DPI - drive handlers with `javascript_tool` instead.
- Local `data/` is disposable dev scratch full of fake test data.
- The login rate limiter (20/15min/IP) will lock you out during repeated auth
  tests - restart the server to reset it.
