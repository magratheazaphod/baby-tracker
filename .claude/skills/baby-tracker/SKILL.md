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
  form builder, hand-rolled SVG charts, WHO growth percentiles (LMS math),
  sleep-interval inference, theme toggle, push subscribe.
- `public/growth-curves.js` — WHO 0-24mo LMS tables (daily resolution early),
  both sexes; table picked at runtime from `BABY_SEX`. WHO (not CDC 2000) is
  deliberate: it's what US pediatricians use under age 2 — parents compare
  the app's percentiles to doctor visits.
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
  `awake_after` on the feed event *preceding* the interval. A formula feed
  within 1h after a breastfeed is a top-up (they always breastfeed first,
  supplement if needed): that gap is always awake and not toggleable —
  explicit parent feedback. Other gaps default asleep, tap to flip.

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

## Demo data & screenshots (anything published: README, issues, demos)

Never screenshot the real instance or the local `.env`/`data/`. Run a fully
synthetic instance instead — a demo env file plus a throwaway `DATA_DIR`, so
no real name, date, or measurement can reach a published image.

```sh
SCRATCH=/tmp/bt-demo                     # anywhere outside the repo
cat > $SCRATCH/demo.env <<'EOF'
USER_NAMES=Alex,Sam
BABY_NAME=Robin
APP_NAME=Robin
BIRTH_DATE=2026-05-02
BABY_SEX=girl
HOME_TZ=America/Los_Angeles
APP_SECRET=demo
DATA_DIR=/tmp/bt-demo/demo-data
PORT=3100
EOF
SEED_DIR=$SCRATCH/demo-data SEED_BIRTH=2026-05-02 \
  SEED_NOW=2026-07-23T15:40:00-07:00 node scripts/seed-demo-data.js
node --env-file=$SCRATCH/demo.env server/index.js    # port 3100
```
- `--env-file=` (not `--env-file-if-exists=.env`) is load-bearing: it keeps
  the real `.env` — names, `ANTHROPIC_API_KEY` — out of the demo process.
  Use a spare port so the real dev server on 3000 is untouched.
- `scripts/seed-demo-data.js` writes ~2 months of plausible feeds, diapers,
  weekly growth measurements and milestones from a seeded PRNG, so re-runs
  reproduce the same screenshots. It refuses to target a live `DATA_DIR`.
  Re-seeding while the server runs needs a restart (it holds the DB open).
- Log in from the page with
  `fetch('/api/login', {method:'POST', headers:{'content-type':'application/json'}, body:'{"secret":"demo","user":"Alex"}'})`.

Capturing phone-shaped shots (the window won't resize below the OS minimum,
and screenshot region coords are unreliable at scaled DPI):
1. Replace the tab with a wrapper holding a same-origin iframe of the app —
   `#f{width:390px;height:515px;position:fixed;top:0;left:0}` on a
   `#ff00ff` body. 515px is what fits the visible viewport including the
   bottom nav; the iframe gets a true 390px layout viewport, so mobile
   media queries apply.
2. Drive views from the parent via the iframe's `contentWindow` — click
   `nav [data-view=...]` / `[data-rtab=...]`, then `scrollTo`.
3. Screenshot with `save_to_disk`, then `node scripts/crop-screenshot.js
   <shot> <out.png>`, which trims at the magenta boundary.

Before publishing, re-read every image and confirm only synthetic names and
values appear, and state in the surrounding copy that shots are anonymized.

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
