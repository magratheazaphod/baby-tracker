---
name: baby-tracker-publishing
description: How to produce anonymized baby-tracker screenshots and demo content for anything published - README images, GitHub issues, demos. Covers running a fully synthetic instance (demo env + seeded throwaway data) and capturing phone-shaped screenshots. Load before capturing any screenshot or writing published copy that shows app data.
---

# Baby Tracker — publishing & screenshots

The repo is public and the family must not be identifiable from it (see
CLAUDE.md). Never screenshot the real instance or the local `.env`/`data/`.
Run a fully synthetic instance instead — a demo env file plus a throwaway
`DATA_DIR`, so no real name, date, or measurement can reach a published image.

## Synthetic instance

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

## Phone-shaped screenshots

The window won't resize below the OS minimum, and screenshot region coords are
unreliable at scaled DPI, so:

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
