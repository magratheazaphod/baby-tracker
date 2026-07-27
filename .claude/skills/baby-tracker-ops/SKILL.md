---
name: baby-tracker-ops
description: Production operations for baby-tracker - deploying to Fly.io and the backup pipeline (volume snapshots, /api/export, the launchd agent on the dev Mac). Load before running a deploy, or when changing anything about /api/export, its auth, or backups.
---

# Baby Tracker — production ops

Production is live and the parents depend on it.

## Deploy

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
- Commit (with the privacy audit from CLAUDE.md) before deploying; push to the
  GitHub remote.

## Backups (already running — don't break)

- Fly volume snapshots: daily, 30-day retention.
- `GET /api/export` → tar.gz of consistent SQLite copy + photos. It accepts
  `Authorization: Bearer <APP_SECRET>` in addition to the login cookie, which
  is what the cron backup uses.
- Daily launchd agent on the dev Mac (`~/Library/LaunchAgents/*backup*.plist`,
  contains the secret, mode 600) pulls to `~/baby-tracker-backups/`, keeps 30.
- If the export path or auth changes, update the plist and re-test with
  `launchctl kickstart`.
