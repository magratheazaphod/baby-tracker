# Making baby-tracker installable by other families

Status: agreed 2026-09-17. Target audience is **technical parents** - people
comfortable with Docker, a VPS, or Fly - not the general public. A hosted
multi-tenant service with accounts is explicitly out of scope.

## Where we are

Already in place: every personal value comes from env with generic fallbacks,
a Dockerfile, `fly.toml.example`, `/api/health`, a three-layer backup story,
a synthetic demo seeder and anonymized screenshots. The architecture does not
need to change; the remaining work is packaging, trust signals and docs.

## What blocks a stranger today

- No license file, so nobody may legally use or fork it.
- Fly is the only documented deploy path. Self-hosters expect
  `docker compose up` behind Caddy/Traefik; push and PWA install need HTTPS.
- First boot needs manual steps (`npm run make-icons`, VAPID key generation).
- No tests, no CI - nothing signals "maintained software" to a reviewer.
- README still describes the newborn-era app; gallery, growth, milestones,
  vaccines and voice logging are absent from the intro and screenshots.
- Design scope (two caregivers, one baby, CDC/US schedules, English) is
  implicit rather than stated.
- Heavy required deps (`sharp`, Anthropic SDK) even when the feature is off;
  `sharp` builds are a known self-host support headache on ARM.
- No tags, changelog, or stated upgrade/migration behaviour.

## Plan - one PR per step

1. **License and scope statement.** Add a LICENSE (MIT favoured for adoption;
   AGPL if forks-must-stay-open matters more - decide before merging). README
   gains "Who this is for" and "Not goals" sections.
2. **Zero-config first boot.** Auto-generate icons and VAPID keys when absent
   and persist them under `DATA_DIR`. Print a startup banner listing which
   optional features are enabled. Refuse to start in production with the
   default secret. A fresh clone + `npm start` must just work.
3. **Generic self-host path.** `docker-compose.yml` with a named volume and a
   Caddy example for HTTPS; a "Deploy anywhere" README section beside the Fly
   one. GitHub Actions publishes a prebuilt image to GHCR on tag so users
   never build `sharp` themselves.
4. **Test suite and CI.** Node's built-in test runner against a throwaway
   `DATA_DIR`: auth boundaries, per-type validation, reports aggregation,
   nudge state machine, export. Runs on every PR. (Promotes the roadmap's
   standing "API test suite" item.) Do this before 2 and 3 if feature work
   continues in parallel - it also protects the live family instance.
5. **README rewrite and fresh screenshots.** Re-seed the demo via the
   `baby-tracker-publishing` skill; capture home, gallery, growth,
   milestones, vaccines. Restructure as a product page: what it is,
   screenshots, features, 5-minute install, configuration, backups,
   contributing. Add CHANGELOG.md and tag `v1.0.0`.
6. **Portfolio hook.** A separate read-only demo instance seeded with
   synthetic data (own Fly app, `APP_SECRET=demo`), linked from a short case
   study on jesse-day.com. Never touches production.

## Deferred, only on demand

- Settings page that edits config from the UI instead of env.
- i18n of UI strings.
- Pluggable vaccine/milestone schedules beyond CDC.
- Making `sharp` and the Anthropic SDK optional dependencies.
