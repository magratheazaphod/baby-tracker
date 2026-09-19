# Roadmap - agreed next steps

## Month-one-plus transition (in flight, one PR per phase)

The app's center of gravity is shifting from newborn feed/diaper logging to
growth, milestones, vaccinations and photos. Old features stay, one tap
deeper, with a classic-layout escape hatch.

1. Reframe: Home-first nav, legacy-layout toggle, all-time growth endpoint,
   NUDGE_HOURS=0 off-switch.
2. Photos gallery: thumbnails, baby-month grouping, monthly-shot badges.
3. Photo nudges: monthly-birthday and staleness push reminders.
4. Milestones: CDC checklist with check-off (kind = cdc:<id>).
5. Vaccinations: new event type + CDC/ACIP schedule checklist.

Decided and deferred: short video clips (minimal store-and-play design
sketched; excluded-from-export storage), vaccine push reminders (checklist
due badges suffice).

## Standing items

1. Extend the API test suite to the checklist and photo-nudge surfaces
   (auth is covered; behaviour is not). Photo upload, thumbnails, photo
   attach/remove cleanup and the push test route are covered as of #30.
2. Optional: store original-resolution photos (currently 1600px only).

Done: /api/health + Fly http check; refresh-on-focus (duplicate-entry
warning still open); API test suite + CI (PR #22); per-PR docs-accuracy
check (PR #24).

## Self-hostable release (agreed 2026-09-17)

Package the app so technical parents can install it themselves. Six PRs:
license + scope (#29, done), zero-config first boot (#25,
done), docker-compose path + GHCR image (#26, done), test suite + CI (#22,
done), README rewrite (#23, text done; screenshots + v1.0.0 tag remain),
hosted demo for the portfolio. Details in `docs/plans/self-hostable.md`.
