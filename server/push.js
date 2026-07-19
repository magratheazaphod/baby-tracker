import webpush from 'web-push'
import fs from 'node:fs'
import path from 'node:path'
import { db, DATA_DIR, getMeta, setMeta } from './db.js'

const HOME_TZ = process.env.HOME_TZ || 'America/Los_Angeles'
const NUDGE_HOURS = Number(process.env.NUDGE_HOURS || 6)
const RENUDGE_MINUTES = Number(process.env.RENUDGE_MINUTES || 60)
const CHECK_INTERVAL_MS = 5 * 60 * 1000

// Feeds and diapers are the "signs of life" that reset the nudge clock;
// weights and photos are too occasional to count.
const TRACKED_TYPES = ['breastfeed', 'formula', 'diaper']

const TYPE_LABELS = {
  breastfeed: '🤱 breastfeeding',
  formula: '🍼 formula',
  diaper: '💩 a diaper',
}

function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    }
  }
  // Dev convenience: generate once and persist alongside the database.
  const keyFile = path.join(DATA_DIR, 'vapid.json')
  if (fs.existsSync(keyFile)) return JSON.parse(fs.readFileSync(keyFile, 'utf8'))
  const keys = webpush.generateVAPIDKeys()
  fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2))
  return keys
}

export const vapidKeys = loadVapidKeys()

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
)

export async function sendToAll(payload) {
  const subs = db.prepare('SELECT id, subscription FROM push_subscriptions').all()
  const body = JSON.stringify(payload)
  let sent = 0
  for (const row of subs) {
    try {
      await webpush.sendNotification(JSON.parse(row.subscription), body)
      sent++
    } catch (err) {
      // 404/410 mean the subscription is dead (app reinstalled, permission revoked).
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id)
      } else {
        console.error('push failed:', err.statusCode || err.message)
      }
    }
  }
  return sent
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatLocalTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: HOME_TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export async function checkNudge(now = new Date()) {
  const last = db
    .prepare(
      `SELECT type, occurred_at FROM events
       WHERE type IN (${TRACKED_TYPES.map(() => '?').join(',')})
       ORDER BY occurred_at DESC LIMIT 1`
    )
    .get(...TRACKED_TYPES)
  if (!last) return

  const sinceLast = now - new Date(last.occurred_at)
  if (sinceLast < NUDGE_HOURS * 3600 * 1000) return

  const lastNudge = getMeta('last_nudge_at')
  if (lastNudge && now - new Date(lastNudge) < RENUDGE_MINUTES * 60 * 1000) return

  const sent = await sendToAll({
    title: '👶 Time for a check-in?',
    body: `No entries in ${formatDuration(sinceLast)} — last was ${TYPE_LABELS[last.type]} at ${formatLocalTime(last.occurred_at)}.`,
  })
  setMeta('last_nudge_at', now.toISOString())
  console.log(`nudge sent to ${sent} device(s); last entry ${last.type} at ${last.occurred_at}`)
}

export function startNudgeTimer() {
  setInterval(() => checkNudge().catch(err => console.error('nudge check failed:', err)), CHECK_INTERVAL_MS)
  console.log(`nudge timer running: threshold ${NUDGE_HOURS}h, re-nudge every ${RENUDGE_MINUTES}m`)
}
