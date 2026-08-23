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

1. API test suite (validation, auth boundaries, reports aggregation, nudge,
   and now the checklist/thumbnail/photo-nudge surfaces).
2. Optional: store original-resolution photos (currently 1600px only).

Done: /api/health + Fly http check; refresh-on-focus (duplicate-entry
warning still open).
