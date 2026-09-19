# Making baby-tracker installable by other families

Status: agreed 2026-09-17. Target audience is **technical parents** - people
comfortable with Docker, a VPS, or Fly - not the general public. A hosted
multi-tenant service with accounts is explicitly out of scope.

## Where we are

Already in place: every personal value comes from env with generic fallbacks,
a Dockerfile, `fly.toml.example`, `/api/health`, a three-layer backup story,
a synthetic demo seeder and anonymized screenshots. The architecture does not
need to change; the remaining work is packaging, trust signals and docs.

## What blocked a stranger on 2026-09-17 (status as of 2026-09-18)

- No license file, so nobody may legally use or fork it. **Done**: MIT,
  per the owner's global licensing policy.
- Fly was the only documented deploy path. **Done** in #26: docker-compose,
  Caddy overlay, GHCR image published on tags.
- First boot needed manual steps (`npm run make-icons`, VAPID key
  generation). **Done** in #25: both were already automatic; docs fixed,
  startup banner added, production refuses the default secret.
- No tests, no CI. **Done** in #22 (98-test API suite, CI on every PR) and
  #24 (per-PR docs-accuracy check).
- README described the newborn-era app. **Done**: text in #23, fresh
  screenshots, CHANGELOG and the `v1.0.0` tag in the release PR.
- Design scope (two caregivers, one baby, CDC/US schedules, English) was
  implicit. **Done**: README has "Who it is for" and "Not goals".
- Heavy required deps (`sharp`, Anthropic SDK) even when the feature is off.
  **Mitigated** by the prebuilt image; making them optional stays deferred.
- No tags, changelog, or stated upgrade/migration behaviour. **Done**:
  CHANGELOG.md, `v1.0.0` tag, and the changelog notes that migrations run
  at startup.

## Plan - one PR per step

1. **License and scope statement.** Done: MIT LICENSE, `license` field in
   package.json, README License section with the public-data carve-out, and
   "Who it is for" / "Not goals" sections.
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
6. **Portfolio hook.** A separate demo instance seeded with synthetic data,
   linked from a short case study on the owner's portfolio site. Because the
   login secret will be public, it needs safeguards the code does not have
   yet:
   - **done:** a `DEMO_MODE=1` env flag that rejects every mutating route
     (events, photos, voice, push subscribe, re-analyze) at middleware level
     and disables `/api/export`;
   - no `ANTHROPIC_API_KEY`, `TRANSCRIBE_API_KEY`, `VOICE_TOKEN` or VAPID
     keys on that instance, so there is no paid API or push surface;
   - a Fly app name and volume unrelated to the production app;
   - seeded only by `scripts/seed-demo-data.js` with the demo env from the
     `baby-tracker-publishing` skill, re-seeded on a schedule, and never
     from the production `.env` or a backup tarball.
   Everything under `docs/plans/` stays synthetic-only, like the rest of
   the repo.

## Deferred, only on demand

- Settings page that edits config from the UI instead of env.
- i18n of UI strings.
- Pluggable vaccine/milestone schedules beyond CDC.
- Making `sharp` and the Anthropic SDK optional dependencies.
