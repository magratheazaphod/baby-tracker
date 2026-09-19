# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are git
tags, and each tag publishes a multi-arch image to GitHub Container Registry.
Database migrations run automatically at startup, so upgrading is a matter
of pulling the new image or code and restarting.

## [1.0.0] - 2026-09-19

First release intended for other families to install.

### Added
- MIT license, "Who it is for" and "Not goals" statements.
- Docker path: `docker-compose.yml`, a Caddy HTTPS overlay, and a prebuilt
  `ghcr.io/magratheazaphod/baby-tracker` image for linux/amd64 and arm64.
- Zero-config first boot: data directory and push keys are created on first
  start, a startup banner lists which optional features are on, and a
  production instance refuses to start with the default secret.
- `DEMO_MODE=1`: read-only mode that blocks every write, upload, push and
  export, for public demo instances.
- API test suite (98 tests) run by CI on every pull request, plus an
  automated documentation-accuracy review comment on each PR.
- Fresh anonymized screenshots of every view.

### Existing features at this release
- Logging of breastfeeding, bottle (formula or breast milk), pumping,
  diapers, weight, height, head circumference, milestones, vaccinations
  and photos, with an instant-save diaper flow and editable timestamps.
- Home, Photos, Growth, Checklists and Timeline views, with a classic
  Log-first layout toggle.
- WHO 0-24 month growth percentiles, CDC milestone checklist, CDC/ACIP
  immunization schedule.
- Daily feeding, diaper and appetite reports; inferred sleep cycles.
- Web Push nudges for quiet stretches, stale galleries and monthly photos.
- Optional voice logging via an in-app microphone or a Siri Shortcut, and
  optional Claude analysis of diaper photos.
- One-request tar.gz export of the database and photos; health endpoint.
