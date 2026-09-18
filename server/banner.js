// One-screen startup summary so a fresh install can see at a glance what is
// configured and which optional features are live. Prints on/off and key
// sources only; never a secret value.
import path from 'node:path'

const on = (v) => (v ? 'on' : 'off')

export function printBanner({ port, homeTz, dataDir, appName, vapidSource }) {
  const env = process.env
  const nudgeHours = Number(env.NUDGE_HOURS || 6)
  const photoNudges = Number(env.PHOTO_NUDGE_DAYS ?? 3) > 0 || env.MONTHLY_PHOTO_NUDGE !== '0'
  const growth = !!env.BIRTH_DATE && ['boy', 'girl'].includes(env.BABY_SEX)
  const lines = [
    `${appName} listening on :${port}`,
    `  timezone   ${homeTz}`,
    `  data       ${path.resolve(dataDir)}`,
    `  push       on (VAPID keys: ${vapidSource})`,
    `  nudges     feed ${nudgeHours > 0 ? `after ${nudgeHours}h` : 'off'}, photo ${on(photoNudges)}`,
    `  growth     ${growth ? 'percentiles on' : 'percentiles off (set BIRTH_DATE and BABY_SEX)'}`,
    `  ai         diaper analysis ${on(env.ANTHROPIC_API_KEY)}, in-app mic ${on(env.TRANSCRIBE_API_KEY)}, Siri voice ${on(env.VOICE_TOKEN)}`,
  ]
  console.log(lines.join('\n'))
}
