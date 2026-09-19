# Baby Tracker

A self-hosted baby-tracking PWA two parents use from iPhones. One Node.js
process (Express + better-sqlite3) serves a no-build vanilla-JS frontend, owns
SQLite + photos on a Fly.io volume, and runs a push-notification nudge timer.
No framework, no bundler. `npm test` runs an API suite (Node's built-in
runner, `test/`) covering auth boundaries, validation, reports, export and
the nudge logic; UI verification is manual. CI runs that suite on every PR
and push to main, plus a documentation-accuracy check that comments on each
non-draft PR raised from this repo (`.github/workflows/docs-check.yml`); it
never pushes, and fork PRs are skipped.

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
  `*.html`, `*.yml` - expect zero hits in committable files - and eyeball
  `git add -n` output for unexpected files.
- Anonymous requests must never receive personal data: `/api/config` returns
  only `{user:null}` pre-auth, the manifest returns a generic name without a
  login cookie, login is two-step (secret proven → names revealed). Preserve
  these properties when touching auth or adding endpoints.
- Anything published (README, issues, demos) must use a fully synthetic
  instance, never the real one - see the `baby-tracker-publishing` skill.
- The owner's name appears in exactly one committed place: the copyright line
  of `LICENSE`, as required by the MIT text and the owner's licensing policy.
  It is the public GitHub account holder's name, not the other parent's or the
  baby's, and the privacy grep will hit it; that hit is expected.
- The public demo (`baby-tracker-demo`, config in `deploy/fly.demo.toml`)
  is a separate Fly app with only synthetic data and is meant to be linked
  from the README. The rule about never committing the deployed app name or
  URL applies to the family's instance, not the demo.
- The Anthropic federation, organization, workspace and service-account IDs
  in `.github/workflows/docs-check.yml` are intentionally committed: they are
  identifiers, not credentials, and the Console rule (this repo, pull_request
  runs, owner pinned by numeric ID) is what restricts their use.

## Workflow

- Work on a branch and open a PR. `main` is what's deployed - never push to it
  directly.
- Every non-draft, same-repo PR gets an automated docs-accuracy comment from
  Claude: it audits README, CLAUDE.md, `.env.example`, `fly.toml.example` and
  `docs/*` against the diff. Comment-only (one sticky comment, no commits);
  authenticates via workload identity federation, so there is no repository
  secret to rotate.
- Deploying and the backup pipeline: `baby-tracker-ops` skill.
- Screenshots, demo data, anything published: `baby-tracker-publishing` skill.
- Agreed next steps: `docs/roadmap.md`.

## Lifecycle phase

The app started newborn-focused: feed/diaper logging plus a feed-nudge timer
("no entry in N hours → push") for the ≤2-month stretch where those events
are the whole picture. It has since grown into the older-baby phase - growth
charts, a CDC milestone checklist, vaccinations, a photo gallery - and the
newborn-only features now matter less day to day.

That's a real phase transition, not a permanent one: sleep regressions,
illness, or a future sibling can make the newborn-era features relevant
again. Favor config toggles over deleting code when a feature's usefulness
is phase-dependent:
- The feed nudge is config, not code - `NUDGE_HOURS` (env var / Fly secret)
  is currently `0` (off) because quick feed/diaper logging isn't the
  priority right now; set it back (e.g. `6`) to re-enable, no code change
  needed.
- The milestone checklist's age brackets are date-driven off `BIRTH_DATE`
  (`public/milestone-checklist.js`), so it naturally goes from "nothing due
  yet" to relevant as baby ages, without touching code.

When adding new phase-sensitive behavior, prefer the same pattern: gate on
config/date rather than hardcoding a newborn-only or older-baby-only
assumption, so the app can flex as the family's needs change.

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
- `.github/workflows/docs-check.yml` - PR-time docs-accuracy agent. Read-only
  tools plus the PR-comment tool; a prior step writes the diff to `pr.diff`
  so the agent needs no shell.

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
- Don't use claude-in-chrome to verify UI changes here - the user checks the
  UI themselves. Confirm server-side behavior (curl, logs, code reading) and
  hand off for a manual look instead.
- Local `data/` is disposable dev scratch full of fake test data.
- The login rate limiter (20/15min/IP) will lock you out during repeated auth
  tests - restart the server to reset it.
